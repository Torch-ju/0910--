import { createHash } from "node:crypto";
import { createStoryAgents } from "@/lib/ai/agents";
import { StoryProviderError } from "@/lib/ai/model";
import type { AgentEndpoint, AgentRequest, StorySnapshot } from "@/lib/story/contracts";
import { validateSnapshot } from "@/lib/story/storage";
import { validatePair, walkFacts } from "@/lib/story/validation";
import type { ProcessTurnInput, ProcessTurnResult } from "../../../memory-agent/src/domain";
import { NarrativeAgents, archiveChapter, checked, NARRATOR_SCHEMA, PROSE_SCHEMA, ROLE_SCHEMA, SUMMARY_SCHEMA } from "./agents";
import { OrchestrationError, type NarratorOutput, type ProseOutput, type RoleOutput, type Run, type StepName, type StorySession, type SummaryOutput, type Turn, type TurnCommand } from "./contracts";
import { restoreMemory, validateExtraction } from "./memory";
import { NarrativeModelClient } from "./model";
import { buildContext } from "./context";
import { SessionStore, assertId } from "./store";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hasBlockingQuestions = (snapshot: Pick<StorySnapshot, "world" | "characters" | "recognition">) =>
  snapshot.recognition?.questions.some(question => question.blocking) ||
  [...snapshot.world.open_questions, ...snapshot.characters.characters.flatMap(character => character.open_questions)].some(question => question.blocking && question.status === "open");

export function requireReady(snapshot: StorySnapshot): void {
  if (!validateSnapshot(snapshot)) throw new OrchestrationError("invalid_snapshot", "快照结构、版本或引用不完整。", 400);
  if (!snapshot?.world || !snapshot?.characters || validatePair(snapshot.world, snapshot.characters).length) throw new OrchestrationError("invalid_snapshot", "世界与人物数据未通过校验。", 400);
  if (snapshot.snapshot_version !== 1 || !["western_fantasy", "eastern_wuxia"].includes(snapshot.preset_id) || typeof snapshot.input !== "string" || !Array.isArray(snapshot.messages) || (snapshot.recognition !== null && (!snapshot.recognition || !Array.isArray(snapshot.recognition.questions) || snapshot.recognition.questions.some(question => !question || typeof question.blocking !== "boolean")))) throw new OrchestrationError("invalid_snapshot", "快照元数据或识别反馈无效。", 400);
  if (snapshot.world.revision !== snapshot.characters.revision || snapshot.world.revision !== snapshot.snapshot_revision) throw new OrchestrationError("snapshot_revision_mismatch", "世界、人物与快照版本必须一致。", 400);
  if (!snapshot.world.title.value.trim() || !snapshot.world.logline.value.trim() || !snapshot.characters.characters.length) throw new OrchestrationError("setup_required", "请先建立故事名称、故事方向和至少一个人物。");
  if (!snapshot.world.timeline.some(event => event.period === "opening")) throw new OrchestrationError("opening_required", "请先建立故事开局时点。");
  if (hasBlockingQuestions(snapshot)) {
    const questions = [...(snapshot.recognition?.questions.filter(q => q.blocking).map(q => q.question) ?? []), ...[...snapshot.world.open_questions, ...snapshot.characters.characters.flatMap(c => c.open_questions)].filter(q => q.blocking && q.status === "open").map(q => q.question)];
    throw new OrchestrationError("clarification_required", "请先回答：" + [...new Set(questions)].join("；"));
  }
  const pending: string[] = [];
  for (const document of [snapshot.world, snapshot.characters]) walkFacts(document, (fact, path) => {
    if ((typeof fact.value === "string" ? fact.value.trim().length : Array.isArray(fact.value) && fact.value.length) && !["confirmed", "rejected"].includes(fact.status)) pending.push(path + "：" + String(fact.value).slice(0, 60));
  });
  if (pending.length || snapshot.world.title.status !== "confirmed" || snapshot.world.logline.status !== "confirmed" || snapshot.characters.characters.some(character => character.name.status !== "confirmed")) throw new OrchestrationError("confirmation_required", "请确认以下设定后开始剧情：" + pending.slice(0, 12).join("；"));
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
    if (action === "npcs" && hasBlockingQuestions(request)) throw new OrchestrationError("clarification_required", "请先解决世界或人物的关键问题再生成 NPC。");
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
    if (!session) throw new OrchestrationError("story_not_found", "请先初始化已确认的故事。", 404);
    return session;
  }

  async turn(command: TurnCommand, options?: { shouldCancel: () => Promise<boolean> }): Promise<StorySession> {
    assertId(command.story_id); assertId(command.operation_id);
    if (typeof command.input !== "string" || !command.input.trim() || command.input.length > 12000 || !Number.isInteger(command.base_revision) || command.base_revision < 1) throw new OrchestrationError("invalid_request", "本轮输入须为 1–12000 字且提供有效 base_revision。", 400);
    if ((command.close_chapter !== undefined && typeof command.close_chapter !== "boolean") || (command.retry_failed !== undefined && typeof command.retry_failed !== "boolean")) throw new OrchestrationError("invalid_request", "重试与归档选项须为布尔值。", 400);
    return this.store.exclusive(command.story_id, async () => {
      const session = await this.status(command.story_id);
      const fingerprint = hash({ story_id: command.story_id, input: command.input, base_revision: command.base_revision, close_chapter: command.close_chapter ?? false });
      let run = session.runs.find(item => item.operation_id === command.operation_id);
      if (run && run.fingerprint !== fingerprint) throw new OrchestrationError("idempotency_conflict", "同一操作 ID 不能承载不同内容。");
      if (run?.status === "succeeded") return session;
      if (run?.status === "abandoned") throw new OrchestrationError("run_abandoned", "此轮已放弃，请使用新的操作 ID。");
      if (session.revision !== command.base_revision) throw new OrchestrationError("revision_conflict", "故事版本已变化，请读取最新状态。");
      if (session.runs.some(item => item.operation_id !== command.operation_id && !["succeeded", "abandoned"].includes(item.status))) throw new OrchestrationError("unfinished_run", "请先恢复当前未完成轮次，不能跳过后继续写作。");
      if (!run) {
        run = { operation_id: command.operation_id, fingerprint, base_revision: command.base_revision, input: command.input, close_chapter: command.close_chapter ?? false, status: "running", steps: {}, created_at: new Date().toISOString() };
        session.runs.push(run);
        await this.store.save(session); // Persist original input before any paid request.
      }
      const activeRun = run;
      const step = async <T>(name: StepName, work: (id: string) => Promise<T>, local = false): Promise<T> => {
        if (await options?.shouldCancel()) throw new OrchestrationError("task_cancelled", "已在步骤边界停止；已生成结果保留，可恢复或放弃本轮。");
        const prior = activeRun.steps[name];
        if (prior?.status === "done") return prior.result as T;
        const previousId = "op_" + hash([command.story_id, command.operation_id, name, prior?.attempt]).slice(0, 48);
        const receiptReady = prior?.status === "running" && !local && await this.agents.hasCompleted(previousId);
        if (prior && !receiptReady && !command.retry_failed && !local) throw new OrchestrationError("explicit_retry_required", "该步骤失败或结果不明。明确设置 retry_failed=true 才会以新请求重试，可能产生重复费用。");
        const attempt = receiptReady ? prior!.attempt : (prior?.attempt ?? 0) + 1;
        activeRun.steps[name] = { status: "running", attempt };
        activeRun.status = "running";
        delete activeRun.error;
        await this.store.save(session);
        try {
          const id = "op_" + hash([command.story_id, command.operation_id, name, attempt]).slice(0, 48);
          const result = await work(id);
          activeRun.steps[name] = { status: "done", attempt, result };
          await this.store.save(session);
          return result;
        } catch (error) {
          activeRun.steps[name] = { status: "failed", attempt, error: error instanceof OrchestrationError ? error.message : error instanceof StoryProviderError ? error.error.userMessage : "该步骤未完成；可查看服务端请求回执。" };
          throw error;
        }
      };
      try {
        const memory = await restoreMemory(session);
        const knownMemory = await memory.repository.getExtractionContext(command.story_id);
        const { recent, relevant, sourceRecords } = await buildContext(session, command.input, memory.repository);
        const common = { cast: session.snapshot.characters.characters.map(character => ({ id: character.character_id, name: character.name.value, controlled_by: character.controlled_by, known: character.known_information.value, unknown: character.unknown_information.value })), opening: session.snapshot.world.timeline.filter(event => event.period === "opening"), story_state: session.snapshot, summary: session.summary, current_time: session.current_time, current_location: session.current_location, recent_prose: recent, known_memory: { ...knownMemory, source_records: sourceRecords }, relevant_memory: relevant, user_input: command.input, rule: "忽略 status=rejected 的设定；已确认静态设定与动态事实冲突时保留冲突，不静默覆盖。source_records 保留记忆来源：角色自述、转述、推断只能作为有来源的说法，不得升级为旁白事实。" };
        const roles = await step<RoleOutput>("roles", async id => checked(await this.agents.roles(id, common), ROLE_SCHEMA));
        const narrator = await step<NarratorOutput>("narrator", async id => checked(await this.agents.narrator(id, { ...common, character_output: roles.content }), NARRATOR_SCHEMA));
        const prose = await step<ProseOutput>("transcription", async id => {
          const result = checked<ProseOutput>(await this.agents.transcription(id, { story_state: { cast: common.cast, opening: common.opening, snapshot: session.snapshot, current_time: session.current_time, current_location: session.current_location, recent_prose: recent, known_memory: common.known_memory }, summary: session.summary.summary, user_input: command.input, character_output: roles.content, narrator_output: narrator }), PROSE_SCHEMA);
          if (result.current_time !== narrator.current_time || result.current_location !== narrator.current_location) throw new OrchestrationError("scene_conflict", "转写不能改动旁白裁定的时间地点。", 422);
          return result;
        });
        const chapter = session.chapters.length + 1;
        const input: ProcessTurnInput = { storyId: command.story_id, requestId: command.operation_id, turnId: command.operation_id, chapterNo: chapter, sceneNo: session.turns.filter(turn => turn.chapter === chapter).length + 1, previousMemoryVersion: await memory.repository.getMemoryVersion(command.story_id), storyTime: prose.current_time, narrative: { text: prose.content, segments: [{ segmentId: "prose", kind: "narration", text: prose.content, order: 0 }] } };
        const extraction = await step("memory_extraction", async id => validateExtraction(await this.agents.extract(id, input, knownMemory), prose.content, new Set(knownMemory.characters.map(character => character.characterId))));
        const projected = await step<ProcessTurnResult>("memory_update", async () => memory.apply(input, extraction, activeRun.created_at), true);
        const summary = await step<SummaryOutput>("summary", async id => checked(await this.agents.summary(id, { previous_summary: session.summary, prose, memory: projected }), SUMMARY_SCHEMA));
        const turn: Turn = { id: command.operation_id, chapter, input: command.input, prose, memory: projected, created_at: activeRun.created_at };
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
