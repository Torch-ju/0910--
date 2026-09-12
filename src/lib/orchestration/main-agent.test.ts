import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCharacter, createSnapshot, createTimelineEvent, fact } from "@/lib/story/factory";
import { confirmSnapshot } from "@/lib/story/state";
import { MainAgent, requireReady } from "./main-agent";
import { NarrativeAgents, checked, PROSE_SCHEMA } from "./agents";
import type { JsonAgentClient } from "./model";
import { SessionStore } from "./store";
import { PROMPTS, DIRECT_PROSE_PROMPT, INTERACTIVE_PROSE_PROMPT } from "./prompts";
import type { StorySession } from "./contracts";

function snapshot() {
  const value = createSnapshot("eastern_wuxia");
  value.world.title = fact("雁回江湖"); value.world.logline = fact("剑客追查旧信。");
  value.characters.characters = [createCharacter("沈砚", "npc_shen")];
  const opening = createTimelineEvent("客栈开局"); opening.period = "opening"; value.world.timeline = [opening];
  return confirmSnapshot(value);
}
class ScriptedClient implements JsonAgentClient {
  calls: string[] = [];
  fail: string | null = null;
  badEvidence = false;
  advanceScene = false;
  async generate(_id: string, system: string): Promise<unknown> {
    const name = (system === DIRECT_PROSE_PROMPT || system === INTERACTIVE_PROSE_PROMPT) ? "transcription" : Object.entries(PROMPTS).find(([, prompt]) => prompt === system)?.[0] ?? "memory_extraction";
    this.calls.push(name);
    if (this.fail === name) throw Error("Synthetic interruption");
    if (name === "roles") return { content: "沈砚走进客栈。" };
    if (name === "narrator") return { current_time: "二更", current_location: "客栈", background: "雨声渐起。", visible_events: [] };
    if (name === "transcription") return { ...(system===INTERACTIVE_PROSE_PROMPT ? {dialogue:null} : {}), content: this.advanceScene ? "沈砚走进客栈。他等到三更。" : "沈砚走进客栈。", current_time: this.advanceScene ? "三更" : "二更", current_location: "客栈", new_facts: [], timeline_updates: [], foreshadowing: [], chapter_end_hook: "门外传来脚步。" };
    if (name === "summary") return { summary: "沈砚来到客栈。", unresolved_threads: ["门外来人身份"] };
    return { mentions: [{ ref: "shen", displayName: "沈砚", characterIdHint: "npc_shen", evidence: { sourceKind: "narration", segmentId: "prose", quote: this.badEvidence ? "并未发生的事情" : "沈砚走进客栈。", confidence: 1 } }], events: [], facts: [], relationships: [], identities: [] };
  }
}
async function setup() {
  const folder = await mkdtemp(join(tmpdir(), "main-agent-"));
  const client = new ScriptedClient();
  const main = new MainAgent(new SessionStore(folder), new NarrativeAgents(client));
  const initial = snapshot();
  const session = await main.initialize(initial);
  const command = { story_id: initial.world.story_id, operation_id: "op_turn_one", base_revision: session.revision, input: "我推开客栈的门。", close_chapter: true };
  return { main, client, initial, command, folder };
}
const lastRun = (session: StorySession) => session.runs.at(-1)!;

describe("main narrative orchestration", () => {
  it("runs all narrative children, reuses canonical character IDs, and archives only validated prose", async () => {
    const { main, client, command } = await setup();
    const result = await main.turn(command);
    expect(client.calls).toEqual(["transcription", "memory_extraction", "summary"]);
    expect(lastRun(result).status).toBe("succeeded");
    expect(result.revision).toBe(2);
    expect(result.turns[0].memory.affectedCharacterIds).toEqual(["npc_shen"]);
    expect(result.chapters[0].source_turn_ids).toEqual([command.operation_id]);
    expect(result.chapters[0].content).toBe(result.turns[0].prose.content);
    expect(result.chapters[0].content).not.toContain(command.input);
  });
  it("replays the same operation without calls and rejects a changed payload", async () => {
    const { main, client, command } = await setup();
    await main.turn(command);
    expect((await main.turn(command)).turns).toHaveLength(1);
    expect(client.calls).toHaveLength(3);
    await expect(main.turn({ ...command, input: "另一个动作" })).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
  it("stops downstream calls on failure, preserving input but not publishing a partial turn", async () => {
    const { main, client, command } = await setup(); client.fail = "transcription";
    const result = await main.turn(command);
    expect(client.calls).toEqual(["transcription"]);
    expect(result.turns).toHaveLength(0); expect(result.memory_journal).toHaveLength(0);
    expect(lastRun(result)).toMatchObject({ status: "blocked", input: command.input });
    await main.turn(command); expect(client.calls).toHaveLength(1);
  });
  it("resumes after a process restart from the failed summary, retaining prose and memory checkpoints", async () => {
    const { main, client, command, folder } = await setup(); client.fail = "summary";
    const blocked = await main.turn(command);
    expect(blocked.turns).toHaveLength(0);
    expect(lastRun(blocked).steps.memory_update?.status).toBe("done");
    const restartedClient = new ScriptedClient();
    const restarted = new MainAgent(new SessionStore(folder), new NarrativeAgents(restartedClient));
    const done = await restarted.turn({ ...command, retry_failed: true });
    expect(restartedClient.calls).toEqual(["summary"]);
    expect(done.turns).toHaveLength(1); expect(done.memory_journal).toHaveLength(1);
    expect(done.turns[0].memory.memoryVersion).toBe(1);
    const next = await restarted.turn({ ...command, operation_id: "op_turn_two", base_revision: 2 });
    expect(next.turns[1].memory.memoryVersion).toBe(2);
    expect(next.turns[1].memory.affectedCharacterIds).toEqual(["npc_shen"]);
  });
  it("does not allow a new operation to bypass a blocked turn", async () => {
    const { main, client, command } = await setup(); client.fail = "transcription";
    await main.turn(command);
    await expect(main.turn({ ...command, operation_id: "op_skip_failed" })).rejects.toMatchObject({ code: "unfinished_run" });
  });
  it("rejects stale versions before any model call", async () => {
    const { main, client, command } = await setup();
    await expect(main.turn({ ...command, base_revision: 9 })).rejects.toMatchObject({ code: "revision_conflict" });
    expect(client.calls).toEqual([]);
  });
  it("blocks invented evidence but allows the prose to advance the planned scene", async () => {
    const { main, client, command } = await setup(); client.badEvidence = true;
    let result = await main.turn(command);
    expect(lastRun(result).steps.memory_extraction?.status).toBe("failed");
    expect(result.memory_journal).toHaveLength(0);
    const other = await setup(); other.client.advanceScene = true;
    result = await other.main.turn(other.command);
    expect(lastRun(result).status).toBe("succeeded");
    expect(result.current_time).toBe("三更");
    expect(other.client.calls).toEqual(["transcription", "memory_extraction", "summary"]);
  });
  it("leaves chapters open by default and keeps initial settings immutable", async () => {
    const { main, command, initial } = await setup();
    const result = await main.turn({ ...command, close_chapter: false });
    expect(result.chapters).toHaveLength(0);
    expect(result.snapshot).toEqual(initial);
  });
  it("starts from pending settings and unresolved questions without changing their authority", async () => {
    const { main } = await setup(); const initial = snapshot();
    initial.world.open_questions.push({ question_id:"question_time", question:"哪一年？", importance:"high", blocking:true, status:"open", answer:null });
    initial.world.title.status = "pending_confirmation";
    const session = await main.initialize(initial);
    expect(session.snapshot.world.title.status).toBe("pending_confirmation");
    expect(session.snapshot.world.open_questions[0].status).toBe("open");
    const idea = createSnapshot(); idea.input="一名少年在雨夜踏入江湖。";
    expect(() => requireReady(idea)).not.toThrow();
    expect(() => requireReady(createSnapshot())).toThrow();
  });
  it("initialization is idempotent but cannot overwrite an existing story", async () => {
    const { main, initial } = await setup();
    expect((await main.initialize(initial)).revision).toBe(1);
    initial.world.title.value = "不同设定";
    await expect(main.initialize(initial)).rejects.toMatchObject({ code: "story_exists" });
  });
  it("excludes concurrent writers and fails closed on corrupted storage or invalid IDs", async () => {
    const { main, command, folder } = await setup();
    await main.store.exclusive(command.story_id, async () => {
      await expect(main.turn(command)).rejects.toMatchObject({ code: "story_busy" });
    });
    await expect(main.status("../../secret")).rejects.toMatchObject({ code: "invalid_id" });
    const path = join(folder, command.story_id + ".json");
    const original = await readFile(path, "utf8");
    await writeFile(path, original.replace('"checksum":"', '"checksum":"broken'));
    await expect(main.status(command.story_id)).rejects.toMatchObject({ code: "storage_corrupt" });
  });
  it("routes all four setting agents including NPC candidates with unresolved questions", async () => {
    const { initial, main } = await setup();
    const revision = { world: initial.world, warnings: [], assistant_message: "候选" };
    const children = {
      framework: vi.fn(async () => ({ world: initial.world, recognition: { summary: "", character_clues: [], hard_constraints: [], ambiguities: [], questions: [] }, assistant_message: "世界" })),
      npcs: vi.fn(async () => ({ characters: initial.characters, timeline_suggestions: [], warnings: [], assistant_message: "人物" })),
      revise: vi.fn(async () => revision), field: vi.fn(async () => revision),
    };
    const router = new MainAgent(main.store, new NarrativeAgents(new ScriptedClient()), () => children);
    const input = { operation_id: "op_settings", base_revision: initial.snapshot_revision, preset_id: initial.preset_id, input: "修改", world: initial.world, characters: initial.characters, recognition: null };
    for (const action of ["framework", "npcs", "revise", "field"] as const) { await router.settings(action, input); expect(children[action]).toHaveBeenCalledOnce(); }
    input.world.open_questions.push({ question_id: "question_block", question: "地点？", blocking: true, importance: "high", status: "open", answer: null });
    await router.settings("npcs", input);
    expect(children.npcs).toHaveBeenCalledTimes(2);
  });
  it("recovers a failed final save without duplicating memory, prose or model calls", async () => {
    const { main, client, command } = await setup();
    const originalSave = main.store.save.bind(main.store);
    let failOnce = true;
    vi.spyOn(main.store, "save").mockImplementation(async session => {
      if (failOnce && lastRun(session).status === "succeeded") { failOnce = false; throw Error("Synthetic disk failure"); }
      return originalSave(session);
    });
    const blocked = await main.turn(command);
    expect(blocked.turns).toHaveLength(0); expect(blocked.memory_journal).toHaveLength(0);
    const recovered = await main.turn(command);
    expect(lastRun(recovered).status).toBe("succeeded");
    expect(recovered.turns).toHaveLength(1); expect(recovered.memory_journal).toHaveLength(1);
    expect(client.calls).toHaveLength(3);
  });
});

it("accepts full prose beyond the previous 16000 character cap", () => {
  const prose = {content:"雨落江湖。".repeat(4000),current_time:"夜",current_location:"客栈",new_facts:[],timeline_updates:[],foreshadowing:[],chapter_end_hook:"门开了。"};
  expect(() => checked(prose,PROSE_SCHEMA)).not.toThrow();
  expect(PROMPTS.narrator).toContain("草蛇灰线");
  expect(PROMPTS.transcription).toContain("不设固定字数");
});
