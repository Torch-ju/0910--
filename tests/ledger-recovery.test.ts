import { describe, it, expect, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { RequestLedger } from "@/lib/ai/model";
import { NarrativeModelClient } from "@/lib/orchestration/model";
import { NarrativeAgents } from "@/lib/orchestration/agents";
import { MainAgent } from "@/lib/orchestration/main-agent";
import { DATA_BOUNDARY } from "@/lib/orchestration/prompts";
import { creativeSnapshot } from "@/lib/orchestration/creative-context";
import { buildContext } from "@/lib/orchestration/context";
import { restoreMemory } from "@/lib/orchestration/memory";
import { fixture, FixtureModel } from "./narrative-fixture";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
describe("model receipt recovery", () => {
  it.each(["running", "failed"] as const)("reuses a completed receipt when the story says %s, without paying again", async status => {
    const { main, session, directory, command } = await fixture();
    vi.stubEnv("LLM_BASE_URL", "http://localhost:9999"); vi.stubEnv("LLM_MODEL", "test-text"); vi.stubEnv("LLM_API_KEY", "test-only");
    const ledger = new RequestLedger(join(directory, "ledger.json")), agents = new NarrativeAgents(new NarrativeModelClient(ledger));
    const scripted = new FixtureModel();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      expect(request.max_tokens).toBeUndefined();
      const system = request.messages[0].content.split("\n" + DATA_BOUNDARY)[0];
      const output = await scripted.generate("fixture", system);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }] }), { status: 200 });
    });
    const memory = await restoreMemory(session), known = await memory.repository.getExtractionContext(command.story_id), { recent, relevant, sourceRecords } = await buildContext(session, command.input, memory.repository);
    const common = { cast: session.snapshot.characters.characters.map(character => ({ id: character.character_id, name: character.name.value, controlled_by: character.controlled_by, known: character.known_information.value, unknown: character.unknown_information.value })), opening: session.snapshot.world.timeline.filter(event => event.period === "opening"), story_state: creativeSnapshot(session.snapshot), summary: session.summary, current_time: session.current_time, current_location: session.current_location, recent_prose: recent, known_memory: { ...known, source_records: sourceRecords }, relevant_memory: relevant, user_input: command.input, rule: "忽略 status=rejected 的设定；已确认静态设定与动态事实冲突时保留冲突，不静默覆盖。source_records 保留记忆来源：角色自述、转述、推断只能作为有来源的说法，不得升级为旁白事实。" };
    const child = "op_" + hash([command.story_id, command.operation_id, "narrator", 1]).slice(0,48);
    const roles = await agents.roles("local", common);
    await agents.narrator(child, { ...common, character_output: roles.content }); expect(await ledger.used()).toBe(1);
    session.runs.push({ operation_id: command.operation_id, fingerprint: hash({ story_id: command.story_id, input: command.input, base_revision: command.base_revision, close_chapter: false }), base_revision: 1, input: command.input, close_chapter: false, status: "running", created_at: new Date().toISOString(), steps: { roles: { status: "done", attempt: 1, result: roles }, narrator: { status, attempt: 1 } } });
    await main.store.save(session);
    const restarted = new MainAgent(main.store, agents); const result = await restarted.turn(command);
    expect(result.runs[0].status).toBe("succeeded"); expect(await ledger.used()).toBe(4); expect(scripted.calls).toBe(4);
  });
});
