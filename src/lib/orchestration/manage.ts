import { continuationId } from "./npc-dialogue";
import { INTERACTIVE_PROSE_SCHEMA, validateDialogue } from "./dialogue";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { memoryCommandSchema } from "./management-schema";
import { validateBackupShape } from "./backup-validation";
import { MainAgent, requireReady } from "./main-agent";
import { archiveChapter, checked, PROSE_SCHEMA, SUMMARY_SCHEMA } from "./agents";
import { OrchestrationError, type ManageCommand, type StorySession } from "./contracts";
import { assertId } from "./store";
import { restoreMemory, validateExtraction } from "./memory";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class StoryManager {
  constructor(readonly main = new MainAgent()) {}
  async list() {
    let names: string[];
    try { names = await readdir(this.main.store.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return Promise.all(names.filter(name => name.endsWith(".json")).sort().map(async name => {
      const storyId = name.slice(0, -5);
      try {
        const story = await this.main.status(storyId);
        return { story_id: storyId, title: story.snapshot.world.title.value, revision: story.revision, turns: story.turns.length, chapters: story.chapters.length, error: null };
      } catch { return { story_id: storyId, title: "故事文件需检查", revision: 0, turns: 0, chapters: 0, error: "无法读取，原文件保留" }; }
    }));
  }
  async memory(storyId: string) {
    const memory = await restoreMemory(await this.main.status(storyId));
    return memory.repository.exportCheckpoint();
  }
  async manage(command: ManageCommand) {
    assertId(command.story_id); assertId(command.operation_id);
    if (!Number.isInteger(command.base_revision)) throw new OrchestrationError("invalid_revision", "请提供叙事版本。", 400);
    return this.main.store.exclusive(command.story_id, async () => {
      const session = await this.main.status(command.story_id);
      const fingerprint = digest(command);
      const prior = session.audit?.find(item => item.operation_id === command.operation_id);
      if (prior) { if (prior.fingerprint !== fingerprint) throw new OrchestrationError("idempotency_conflict", "同一操作不能更换内容。"); return session; }
      if (session.revision !== command.base_revision) throw new OrchestrationError("revision_conflict", "故事已变化，请刷新后重新检查。");
      const unfinished = session.runs.find(run => !["succeeded", "abandoned"].includes(run.status));
      if (unfinished && command.action !== "abandon") throw new OrchestrationError("unfinished_run", "请先恢复或放弃未完成轮次。");
      let detail: unknown = null;
      if (command.action === "abandon") {
        const run = session.runs.find(run => run.operation_id === command.run_id);
        if (!run || run.status === "succeeded") throw new OrchestrationError("invalid_run", "已完成轮次不能放弃。", 400);
        run.status = "abandoned"; const conversation=session.conversations?.find(c=>c.run_id===run.operation_id);if(conversation)conversation.status="abandoned"; detail = { run_id: run.operation_id };
      } else if (command.action === "close_chapter") {
        const number = session.chapters.length + 1;
        const turns = session.turns.filter(turn => turn.chapter === number);
        if (!turns.length) throw new OrchestrationError("empty_chapter", "当前章还没有已完成正文。", 400);
        session.chapters.push(archiveChapter(number, turns, session.summary));
      } else if (command.action === "sync") {
        if (command.confirmed !== true) throw new OrchestrationError("confirmation_required", "请先检查差异并确认。", 400);
        requireReady(command.snapshot);
        if (command.snapshot.world.story_id !== command.story_id || command.snapshot.snapshot_revision <= session.snapshot.snapshot_revision) throw new OrchestrationError("snapshot_revision_conflict", "请选择同一故事的更新设定版本。");
        const previousIds = session.snapshot.characters.characters.map(c => c.character_id);
        if (previousIds.length !== command.snapshot.characters.characters.length || previousIds.some(old => !command.snapshot.characters.characters.some(c => c.character_id === old))) throw new OrchestrationError("identity_removal", "同步设定不能增删人物 ID；剧情新人物通过记忆接入，既有人物请在人物记忆中修正身份。");
        detail = { previous: session.snapshot, next: command.snapshot };
        session.seed_snapshot ??= structuredClone(session.snapshot);
        session.snapshot = structuredClone(command.snapshot);
      } else if (command.action === "memory") {
        const value = memoryCommandSchema.parse(command.command);
        const memory = await restoreMemory(session);
        const stamp = new Date().toISOString();
        await memory.maintain(value, command.operation_id, stamp);
        (session.memory_actions ??= []).push({ after_turn: session.memory_journal.length, operation_id: command.operation_id, created_at: stamp, command: value });
        session.memory_checkpoint = { ...memory.checkpoint(), action_count: session.memory_actions.length };
        detail = value;
      } else throw new OrchestrationError("invalid_action", "未知管理操作。", 400);
      (session.audit ??= []).push({ operation_id: command.operation_id, action: command.action, fingerprint, created_at: new Date().toISOString(), detail });
      session.revision++;
      await this.main.store.save(session);
      return session;
    });
  }

  async backup(storyId: string) {
    const session = structuredClone(await this.main.status(storyId));
    delete session.memory_checkpoint; // Derivative caches are rebuilt, never trusted on import.
    return { format: "shuzhongren-backup", version: 1, checksum: digest(session), session };
  }
  async restore(raw: unknown) {
    const envelope = z.object({ format: z.literal("shuzhongren-backup"), version: z.literal(1), checksum: z.string(), session: z.record(z.string(), z.unknown()) }).strict().parse(raw);
    if (digest(envelope.session) !== envelope.checksum) throw new OrchestrationError("backup_checksum", "备份校验和不匹配。", 400);
    validateBackupShape(envelope.session);
    const session = envelope.session as unknown as StorySession;
    if (session.seed_snapshot) requireReady(session.seed_snapshot);
    requireReady(session.snapshot);
    if (session.version !== 1 || !Number.isInteger(session.revision) || session.revision < 1 || !Array.isArray(session.turns) || !Array.isArray(session.chapters) || !Array.isArray(session.runs) || !Array.isArray(session.memory_journal) || session.turns.length !== session.memory_journal.length) throw new OrchestrationError("invalid_backup", "会话结构或版本无效。", 400);
    if (session.turns.length) checked(session.summary, SUMMARY_SCHEMA);
    else if (session.summary.summary !== "" || session.summary.unresolved_threads.length) throw new OrchestrationError("invalid_backup", "空故事不能包含剧情摘要。", 400);
    const storyId = session.snapshot.world.story_id;
    const seen = new Set<string>();
    if (session.seed_snapshot && session.seed_snapshot.world.story_id !== storyId) throw new OrchestrationError("invalid_backup", "初始设定不属于该故事。", 400);
    if (new Set(session.runs.map(r => r.operation_id)).size !== session.runs.length) throw new OrchestrationError("invalid_backup", "请求 ID 重复。", 400);
    for (const [index, action] of (session.memory_actions ?? []).entries()) {
      if (action.after_turn > session.turns.length || (index > 0 && action.after_turn < session.memory_actions![index - 1].after_turn)) throw new OrchestrationError("invalid_backup", "记忆修正顺序无效。", 400);
    }
    for(const conversation of session.conversations ?? []){
      if(!session.runs.some(r=>r.operation_id===conversation.run_id) || conversation.id!==conversation.run_id || conversation.continuation_id!==continuationId(conversation.id))throw new OrchestrationError("invalid_backup","对话引用无效。",400);
    }
    for (const [index, turn] of session.turns.entries()) {
      assertId(turn.id); if (seen.has(turn.id)) throw new OrchestrationError("invalid_backup", "轮次 ID 重复。", 400); seen.add(turn.id);
      if (turn.chapter > session.chapters.length + 1) throw new OrchestrationError("invalid_backup", "正文引用不存在的章节。", 400);
      checked(turn.prose, Object.hasOwn(turn.prose,"dialogue") ? INTERACTIVE_PROSE_SCHEMA : PROSE_SCHEMA);
      if(Object.hasOwn(turn.prose,"dialogue")) validateDialogue(turn.prose,session,turn.reply_to ? turn.input : undefined);
      if(turn.reply_to && (session.turns[index-1]?.id!==turn.reply_to || !session.turns[index-1]?.prose.dialogue))throw new OrchestrationError("invalid_backup","对话回应的来源轮次不匹配。",400);
      const entry = session.memory_journal[index];
      if (entry.input.storyId !== storyId || entry.input.turnId !== turn.id || entry.input.narrative.text !== turn.prose.content) throw new OrchestrationError("invalid_backup", "正文与记忆日志不匹配。", 400);
      const hints = new Set(entry.extraction.mentions.flatMap(m => m.characterIdHint ? [m.characterIdHint] : []));
      validateExtraction(entry.extraction, turn.prose.content, hints);
    }
    for (const [index, chapter] of session.chapters.entries()) {
      if (chapter.number !== index + 1 || !chapter.source_turn_ids.length || new Set(chapter.source_turn_ids).size !== chapter.source_turn_ids.length) throw new OrchestrationError("invalid_backup", "章节编号或来源重复。", 400);
      const turns = chapter.source_turn_ids.map(id => session.turns.find(turn => turn.id === id));
      if (turns.some(turn => !turn || turn.chapter !== chapter.number) || chapter.content !== turns.map(turn => turn!.prose.content).join("\n\n")) throw new OrchestrationError("invalid_backup", "章节与来源轮次不匹配。", 400);
    }
    // Do not replay untrusted unfinished child checkpoints after importing a backup.
    for (const run of session.runs) {
      assertId(run.operation_id);
      if ((run.status === "succeeded") !== session.turns.some(turn => turn.id === run.operation_id)) throw new OrchestrationError("invalid_backup", "已完成回执与正文不匹配。", 400);
      if (run.status !== "succeeded" && run.status !== "abandoned") {
        const conversation=session.conversations?.find(c=>c.run_id===run.operation_id);
        if(conversation && ["active","ready"].includes(conversation.status)){
          if(run.pipeline!=="dialogue_v2" || conversation.continuation_id!==continuationId(run.operation_id) || conversation.id!==run.operation_id || run.steps.transcription?.status!=="done")throw new OrchestrationError("invalid_backup","对话停点与正文不匹配。",400);
          const prose=checked<import("./contracts").ProseOutput>(run.steps.transcription.result,INTERACTIVE_PROSE_SCHEMA);
          validateDialogue(prose,session);
          if(JSON.stringify(prose.dialogue)!==JSON.stringify(conversation.speaker))throw new OrchestrationError("invalid_backup","对话人物与停点不匹配。",400);
          run.steps={transcription:run.steps.transcription};run.status=conversation.status==="active"?"waiting_dialogue":"blocked";
        } else {run.status="blocked";run.steps={};}
      }
    }
    for (const action of session.memory_actions ?? []) memoryCommandSchema.parse(action.command);
    delete session.memory_checkpoint;
    const memory = await restoreMemory(session, true);
    session.memory_checkpoint = memory.checkpoint();
    return this.main.store.exclusive(storyId, async () => {
      if (await this.main.store.load(storyId)) throw new OrchestrationError("story_exists", "同名故事已存在，恢复不会覆盖现有作品。");
      await this.main.store.save(session); return session;
    });
  }
}
