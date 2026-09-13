import { NpcDialogueAgent, continuationId, conversationProse, attributeConversationEvidence } from "./npc-dialogue";
import { assertDialogueReply, pendingDialogue, playerRole, validateDialogue, INTERACTIVE_PROSE_SCHEMA } from "./dialogue";
import { creativeSnapshot } from "./creative-context";
import { prosePreview } from "@/lib/ai/completion-stream";
import { createHash } from "node:crypto";
import { createStoryAgents } from "@/lib/ai/agents";
import { StoryProviderError } from "@/lib/ai/model";
import type { AgentEndpoint, AgentRequest, StorySnapshot } from "@/lib/story/contracts";
import { validateSnapshot } from "@/lib/story/storage";
import { validatePair } from "@/lib/story/validation";
import type { ProcessTurnInput, ProcessTurnResult } from "../../../memory-agent/src/domain";
import { NarrativeAgents, archiveChapter, checked, NARRATOR_SCHEMA, PROSE_SCHEMA, ROLE_SCHEMA, SUMMARY_SCHEMA } from "./agents";
import { OrchestrationError, type NarratorOutput, type ProseOutput, type RoleOutput, type Run, type StepName, type StorySession, type SummaryOutput, type Turn, type TurnCommand } from "./contracts";
import { restoreMemory, validateExtraction } from "./memory";
import { NarrativeModelClient } from "./model";
import { buildContext } from "./context";
import { SessionStore, assertId } from "./store";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function requireReady(snapshot: StorySnapshot): void {
  if (!validateSnapshot(snapshot)) throw new OrchestrationError("invalid_snapshot", "快照结构、版本或引用不完整。", 400);
  if (!snapshot?.world || !snapshot?.characters || validatePair(snapshot.world, snapshot.characters).length) throw new OrchestrationError("invalid_snapshot", "世界与人物数据未通过校验。", 400);
  if (snapshot.snapshot_version !== 1 || !["western_fantasy", "eastern_wuxia"].includes(snapshot.preset_id) || typeof snapshot.input !== "string" || !Array.isArray(snapshot.messages) || (snapshot.recognition !== null && (!snapshot.recognition || !Array.isArray(snapshot.recognition.questions) || snapshot.recognition.questions.some(question => !question || typeof question.blocking !== "boolean")))) throw new OrchestrationError("invalid_snapshot", "快照元数据或识别反馈无效。", 400);
  if (snapshot.world.revision !== snapshot.characters.revision || snapshot.world.revision !== snapshot.snapshot_revision) throw new OrchestrationError("snapshot_revision_mismatch", "世界、人物与快照版本必须一致。", 400);
  if (!snapshot.input.trim() && !snapshot.world.logline.value.trim() && !snapshot.world.summary.value.trim()) throw new OrchestrationError("setup_required", "请先输入故事想法或提供现有故事设定。");
}

/** Main Agent owns routing, checkpoints and commits. Child agents cannot write the session. */
export class MainAgent {
  constructor(
    readonly store = new SessionStore(),
    private readonly agents = new NarrativeAgents(new NarrativeModelClient()),
    private readonly settingsFactory: () => Pick<ReturnType<typeof createStoryAgents>, AgentEndpoint> = createStoryAgents,
    private readonly chapterCharacters = 12000,
  ) {}

  async settings(action: AgentEndpoint, request: AgentRequest) {
    return this.settingsFactory()[action](request);
  }

  async initialize(snapshot: StorySnapshot): Promise<StorySession> {
    requireReady(snapshot);
    const storyId = snapshot.world.story_id;
    return this.store.exclusive(storyId, async () => {
      const existing = await this.store.load(storyId);
      if (existing) {
        if (hash(existing.snapshot) !== hash(snapshot)) throw new OrchestrationError("story_exists", "该故事已有叙事会话，不能通过初始化覆盖。请继续原会话或创建新故事。");
        return existing;
      }
      const session: StorySession = { version: 1, revision: 1, snapshot: structuredClone(snapshot), summary: { summary: "", unresolved_threads: [] }, turns: [], chapters: [], memory_journal: [], current_time: "", current_location: "", runs: [] };
      await this.store.save(session);
      return session;
    });
  }

  async status(storyId: string): Promise<StorySession> {
    const session = await this.store.load(storyId);
    if (!session) throw new OrchestrationError("story_not_found", "请先开始一个故事。", 404);
    return session;
  }

  async turn(command: TurnCommand, options?: { shouldCancel: () => Promise<boolean> }): Promise<StorySession> {
    if(!command.dialogue_action && (command.dialogue_id!==undefined || command.dialogue_revision!==undefined))throw new OrchestrationError("invalid_dialogue","对话命令缺少操作类型。",400);
    if(command.dialogue_action)return new NpcDialogueAgent(this,this.agents).handle(command,options);
    assertId(command.story_id); assertId(command.operation_id); if(command.reply_to !== undefined)assertId(command.reply_to);
    if (typeof command.input !== "string" || !command.input.trim() || command.input.length > 12000 || !Number.isInteger(command.base_revision) || command.base_revision < 1) throw new OrchestrationError("invalid_request", "本轮输入须为 1–12000 字且提供有效 base_revision。", 400);
    if ((command.close_chapter !== undefined && typeof command.close_chapter !== "boolean") || (command.retry_failed !== undefined && typeof command.retry_failed !== "boolean")) throw new OrchestrationError("invalid_request", "重试与归档选项须为布尔值。", 400);
    return this.store.exclusive(command.story_id, async () => {
      const session = await this.status(command.story_id);
      const fingerprint = hash({ story_id: command.story_id, input: command.input, base_revision: command.base_revision, close_chapter: command.close_chapter ?? false, ...(command.reply_to ? {reply_to: command.reply_to} : {}) });
      let run = session.runs.find(item => item.operation_id === command.operation_id);
      if (run && run.fingerprint !== fingerprint) throw new OrchestrationError("idempotency_conflict", "同一操作 ID 不能承载不同内容。");
      if (run?.status === "succeeded") return session;
      if(run?.status === "waiting_dialogue" && session.conversations?.find(c=>c.run_id===command.operation_id)?.status === "active")return session;
      if (run?.status === "abandoned") throw new OrchestrationError("run_abandoned", "此轮已放弃，请使用新的操作 ID。");
      if (session.revision !== command.base_revision) throw new OrchestrationError("revision_conflict", "故事版本已变化，请读取最新状态。");
      if (session.runs.some(item => item.operation_id !== command.operation_id && !["succeeded", "abandoned"].includes(item.status))) throw new OrchestrationError("unfinished_run", "请先恢复当前未完成轮次，不能跳过后继续写作。");
      assertDialogueReply(session, command);
      if (!run) {
        run = { pipeline: "dialogue_v2", ...(command.reply_to ? {reply_to:command.reply_to} : {}), operation_id: command.operation_id, fingerprint, base_revision: command.base_revision, input: command.input, close_chapter: command.close_chapter ?? false, status: "running", steps: {}, created_at: new Date().toISOString() };
        session.runs.push(run);
        await this.store.save(session); // Persist original input before any paid request.
      }
      const activeRun = run;
      const step = async <T>(name: StepName, work: (id: string) => Promise<T>, local = false): Promise<T> => {
        if (await options?.shouldCancel()) throw new OrchestrationError("task_cancelled", "已在步骤边界停止；已生成结果保留，可恢复或放弃本轮。");
        const prior = activeRun.steps[name];
        if (prior?.status === "done") return prior.result as T;
        const previousId = "op_" + hash([command.story_id, command.operation_id, name, prior?.attempt]).slice(0, 48);
        const receiptReady = !!prior && ["running", "failed"].includes(prior.status) && !local && await this.agents.hasCompleted(previousId);
        if (prior && !receiptReady && !command.retry_failed && !local) throw new OrchestrationError("explicit_retry_required", "该步骤失败或结果不明。明确设置 retry_failed=true 才会以新请求重试，可能产生重复费用。");
        const attempt = receiptReady ? prior!.attempt : (prior?.attempt ?? 0) + 1;
        activeRun.steps[name] = { status: "running", attempt, started_at:new Date().toISOString() };
        activeRun.status = "running";
        delete activeRun.error;
        await this.store.save(session);
        try {
          const id = "op_" + hash([command.story_id, command.operation_id, name, attempt]).slice(0, 48);
          const result = await work(id);
          activeRun.steps[name] = { ...activeRun.steps[name], status: "done", attempt, result, completed_at:new Date().toISOString() };
          await this.store.save(session);
          return result;
        } catch (error) {
          activeRun.steps[name] = { ...activeRun.steps[name], status: "failed", attempt, completed_at:new Date().toISOString(), error: error instanceof OrchestrationError ? error.message : error instanceof StoryProviderError ? error.error.userMessage : "该步骤未完成；可查看服务端请求回执。" };
          throw error;
        }
      };
      try {
        const memory = await restoreMemory(session);
        const knownMemory = await memory.repository.getExtractionContext(command.story_id);
        const { recent, relevant, sourceRecords } = await buildContext(session, command.input, memory.repository);
        const common = { cast: session.snapshot.characters.characters.map(character => ({ id: character.character_id, name: character.name.value, controlled_by: character.controlled_by, known: character.known_information.value, unknown: character.unknown_information.value })), opening: session.snapshot.world.timeline.filter(event => event.period === "opening"), story_state: creativeSnapshot(session.snapshot), summary: session.summary, current_time: session.current_time, current_location: session.current_location, recent_prose: recent, known_memory: { ...knownMemory, source_records: sourceRecords }, relevant_memory: relevant, user_input: command.input, rule: "忽略 status=rejected 的设定；已确认静态设定与动态事实冲突时保留冲突，不静默覆盖。source_records 保留记忆来源：角色自述、转述、推断只能作为有来源的说法，不得升级为旁白事实。" };
        const roles = await step<RoleOutput>("roles", async id => checked(await this.agents.roles(id, common), ROLE_SCHEMA), true);
        const interactive = activeRun.pipeline === "interactive_v1" || activeRun.pipeline === "dialogue_v2";
        const direct = interactive || activeRun.pipeline === "direct_v1";
        const narrator = await step<NarratorOutput>("narrator", async id => direct ? {
          current_time: session.current_time || "依照设定选择合理的开局时刻",
          current_location: session.current_location || "依照设定选择合理的开局地点",
          background: "本地场景提示；人物行动与故事线在正文调用中一次完成。请承接已有场景并自然推进。",
          visible_events: [],
        } : checked(await this.agents.narrator(id, { ...common, character_output: roles.content }), NARRATOR_SCHEMA), direct);
        let prose = await step<ProseOutput>("transcription", async id => {
          let lastPreview=0;
          const progress=async(raw:string)=>{if(raw && Date.now()-lastPreview<700)return;lastPreview=Date.now();const current=activeRun.steps.transcription!;current.preview=prosePreview(raw);if(current.preview && !current.first_content_at)current.first_content_at=new Date().toISOString();try{await this.store.save(session);}catch(error){console.warn("preview save skipped:",error instanceof Error?error.message:String(error));}};
          const proseInput = { story_state: { cast: common.cast, opening: common.opening, snapshot: creativeSnapshot(session.snapshot), current_time: session.current_time, current_location: session.current_location, recent_prose: recent, known_memory: common.known_memory }, summary: session.summary.summary, user_input: command.input, character_output: roles.content, narrator_output: narrator };
          const cue = pendingDialogue(session);
          const refine = (output: unknown) => validateDialogue(output, session, command.reply_to ? command.input : undefined);
          const result = interactive
            ? checked<ProseOutput>(await this.agents.interactiveProse(id, { ...proseInput, player: playerRole(session), npc_response: cue ? { ...cue, player_response:command.input } : null }, refine, progress), INTERACTIVE_PROSE_SCHEMA)
            : checked<ProseOutput>(await (direct ? this.agents.directProse.bind(this.agents) : this.agents.transcription.bind(this.agents))(id, proseInput, progress), PROSE_SCHEMA);
          if(interactive)refine(result);
          // Planning describes the scene setup; prose may advance time and location.
          // Commit the actual ending scene from the validated prose, retaining the plan in run history.
          return result;
        });
        if(activeRun.pipeline === "dialogue_v2" && prose.dialogue) {
          let conversation=session.conversations?.find(c=>c.run_id===activeRun.operation_id);
          if(!conversation){
            conversation={id:activeRun.operation_id,run_id:activeRun.operation_id,revision:1,status:"active",speaker:prose.dialogue,player:playerRole(session),messages:[{role:"npc",name:prose.dialogue.speaker_name,text:prose.dialogue.utterance,operation_id:activeRun.operation_id}],exchanges:[],continuation_id:continuationId(activeRun.operation_id)};
            (session.conversations ??= []).push(conversation);
          }
          if(conversation.status === "active") {
            activeRun.status="waiting_dialogue";await this.store.save(session);return session;
          }
          prose=conversationProse(prose,conversation);
        }
        const chapter = session.chapters.length + 1;
        const input: ProcessTurnInput = { storyId: command.story_id, requestId: command.operation_id, turnId: command.operation_id, chapterNo: chapter, sceneNo: session.turns.filter(turn => turn.chapter === chapter).length + 1, previousMemoryVersion: await memory.repository.getMemoryVersion(command.story_id), storyTime: prose.current_time, narrative: { text: prose.content, segments: [{ segmentId: "prose", kind: "narration", text: prose.content, order: 0 }] } };
        const extraction = await step("memory_extraction", async id => {
          const validated=validateExtraction(await this.agents.extract(id,input,knownMemory),prose.content,new Set(knownMemory.characters.map(character=>character.characterId)));
          const conversation=session.conversations?.find(c=>c.run_id===activeRun.operation_id);
          return conversation ? attributeConversationEvidence(validated,conversation) : validated;
        });
        const projected = await step<ProcessTurnResult>("memory_update", async () => memory.apply(input, extraction, activeRun.created_at), true);
        const summary = await step<SummaryOutput>("summary", async id => checked(await this.agents.summary(id, { previous_summary: session.summary, prose, memory: projected }), SUMMARY_SCHEMA));
        const turn: Turn = { ...(command.reply_to ? {reply_to:command.reply_to} : {}), id: command.operation_id, chapter, input: command.input, prose, memory: projected, created_at: activeRun.created_at };
        const chapterTurns = [...session.turns.filter(item => item.chapter === chapter), turn];
        const archive = await step("chapter", async () => (activeRun.close_chapter || chapterTurns.reduce((length, item) => length + Array.from(item.prose.content).length, 0) >= this.chapterCharacters) ? archiveChapter(chapter, chapterTurns, summary) : null, true);
        // Single commit: prose, summary, memory journal, chapter and run receipt advance together.
        session.turns.push(turn);
        session.memory_journal.push({ input, extraction, created_at: activeRun.created_at });
        // A replayed memory_update did not mutate this fresh projection; apply idempotently.
        await memory.apply(input, extraction, activeRun.created_at);
        session.memory_checkpoint = memory.checkpoint();
        session.summary = summary;
        session.current_time = prose.current_time;
        session.current_location = prose.current_location;
        if (archive) session.chapters.push(archive);
        session.revision++;
        activeRun.status = "succeeded";
        const closedConversation=session.conversations?.find(c=>c.run_id===activeRun.operation_id);
        if(closedConversation){closedConversation.status="closed";closedConversation.continuation_revision=session.revision;}
        await this.store.save(session);
        return session;
      } catch (error) {
        // Reload last durable checkpoint: never persist a half-applied final commit.
        const durable = await this.status(command.story_id);
        const persisted = durable.runs.find(item => item.operation_id === command.operation_id) as Run;
        if (persisted.status === "succeeded") return durable;
        persisted.status = "blocked";
        persisted.error = error instanceof OrchestrationError ? error.message : error instanceof StoryProviderError ? error.error.userMessage : "本轮未完成，请查看已保存的步骤和任务状态。";
        for (const [name, value] of Object.entries(activeRun.steps)) if (value.status === "failed") persisted.steps[name as StepName] = value;
        await this.store.save(durable);
        return durable;
      }
    });
  }
}

export const createMainAgent = () => new MainAgent();
