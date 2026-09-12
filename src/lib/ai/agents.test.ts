import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStoryAgents } from "./agents";
import { readModelConfig, RequestLedger, StoryProviderError } from "./model";
import { hydrateCharacters, hydrateWorld, toWireCharacters, toWireTimelineEvent, toWireWorld, validateWireWorld } from "./wire-contract";
import { createCharacter, createRelationship, createSnapshot, createTimelineEvent, fact } from "@/lib/story/factory";
import type { AgentRequest, CharacterProfiles, FrameworkResult, NpcResult, TimelineEvent } from "@/lib/story/contracts";
import { validateCharacters, validateWorld } from "@/lib/story/validation";

const env = { LLM_BASE_URL: "http://localhost:4010", LLM_MODEL: "test-text-model", LLM_API_KEY: "test-key", LLM_REQUEST_LIMIT: "10" };
const temporaryLedger = async () => new RequestLedger(join(await mkdtemp(join(tmpdir(), "shuzhongren-ai-")), "model-requests.json"));
const response = (body: unknown, usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }], usage }), { status: 200, headers: { "content-type": "application/json" } });
const textResponse = (body: string) => new Response(JSON.stringify({ choices: [{ message: { content: body }, finish_reason: "stop" }] }), { status: 200, headers: { "content-type": "application/json" } });

function request(operation = "op_framework_01"): AgentRequest {
  const snapshot = createSnapshot("western_fantasy");
  return { operation_id: operation, base_revision: snapshot.snapshot_revision, preset_id: snapshot.preset_id, input: "艾琳是一名流亡法师。", world: snapshot.world, characters: snapshot.characters, recognition: null };
}
function recognition() {
  return { summary: "用户提出流亡法师艾琳。", character_clues: [{ label: "艾琳", identity: "流亡法师", evidence: ["艾琳是一名流亡法师。"], existing_character_id: null, controlled_by: "user" as const, ambiguity: null }], hard_constraints: [], ambiguities: [], questions: [] };
}
function frameworkResult(input: AgentRequest): FrameworkResult {
  const world = structuredClone(input.world); const opening = createTimelineEvent("故事开局"); opening.period = "opening"; world.timeline = [opening];
  return { world: toWireWorld(world) as FrameworkResult["world"], recognition: recognition(), assistant_message: "我将先保留艾琳的设定。" };
}
function npcProfiles(input: AgentRequest, count: number): CharacterProfiles {
  return { ...input.characters, characters: Array.from({ length: count }, (_, index) => createCharacter(`角色${index + 1}`, `npc_${index + 1}`)), relationships: [] };
}
function npcResult(input: AgentRequest, count: number): NpcResult {
  return { characters: toWireCharacters(npcProfiles(input, count)) as NpcResult["characters"], timeline_suggestions: [], warnings: [], assistant_message: `提出 ${count} 位人物。` };
}
function sequence(values: Array<Response | Error>) {
  let calls = 0;
  return {
    fetcher: async () => {
      const value = values[calls++];
      if (value instanceof Error) throw value;
      return value;
    },
    calls: () => calls,
  };
}
function recording(values: Array<Response | Error>) {
  const requests: unknown[] = []; let calls = 0;
  return { requests, fetcher: async (_url: string, init: RequestInit) => { requests.push(JSON.parse(String(init.body))); const value = values[calls++]; if (value instanceof Error) throw value; return value; } };
}

describe("StoryAgents", () => {
  it("rejects wire documents missing required business fields", () => {
    const input = request("op_wire_missing"); const wire = toWireWorld(input.world) as Record<string, unknown>;
    Reflect.deleteProperty(wire, "title");
    expect(validateWireWorld(wire)).not.toEqual([]);
  });

  it("repairs a recognition type error with the prior JSON and an exact path", async () => {
    const input = request("op_recognition_repair"); const malformed = frameworkResult(input);
    malformed.recognition = { ...recognition(), character_clues: [{ ...recognition().character_clues[0], evidence: "艾琳" as unknown as string[] }] };
    const mock = recording([response(malformed), response(frameworkResult(input))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.framework(input)).resolves.toMatchObject({ recognition: { summary: expect.any(String) } });
    expect(mock.requests[0]).toMatchObject({response_format:{type:"json_object"}});
    expect(JSON.stringify(mock.requests[1])).toContain("Previous JSON");
    expect(JSON.stringify(mock.requests[1])).toContain("/character_clues/0/evidence");
  });

  it("rejects model attempts to inject public system fields into wire documents", () => {
    const input = request("op_wire_system"); const wire = { ...(toWireWorld(input.world) as Record<string, unknown>), story_id: "story_injected" };
    expect(validateWireWorld(wire)).not.toEqual([]);
  });

  it("hydrates wire state back into documents that pass the public schemas", () => {
    const input = request("op_wire_hydrate");
    const world = hydrateWorld(toWireWorld(input.world), input.world, input.input);
    const characters = hydrateCharacters(toWireCharacters(input.characters), input.characters, input.input);
    expect(validateWorld(world)).toEqual([]);
    expect(validateCharacters(characters)).toEqual([]);
  });

  it("replays a successful operation without another model request", async () => {
    const input = request(); const mock = sequence([response(frameworkResult(input))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    expect(await agents.framework(input)).toEqual(await agents.framework(input));
    expect(mock.calls()).toBe(1);
  });

  it("rejects a reused operation id with a different fingerprint", async () => {
    const input = request(); const mock = sequence([response(frameworkResult(input))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await agents.framework(input);
    await expect(agents.framework({ ...input, input: "不同的故事想法" })).rejects.toMatchObject({ status: 409 });
    expect(mock.calls()).toBe(1);
  });

  it("includes recognition in the idempotency fingerprint", async () => {
    const input = request(); const mock = sequence([response(frameworkResult(input))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await agents.framework(input);
    await expect(agents.framework({ ...input, recognition: recognition() })).rejects.toMatchObject({ status: 409, error: { code: "idempotency_conflict" } });
    expect(mock.calls()).toBe(1);
  });

  it("rejects invalid stable operation ids before calling the provider", async () => {
    const input = request("__proto__"); const mock = sequence([]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.framework(input)).rejects.toMatchObject({ status: 400, error: { code: "invalid_request" } });
    expect(mock.calls()).toBe(0);
  });

  it("charges repair attempts while allowing requests beyond the old local cap", async () => {
    const input = request();
    const mock = sequence([response({ malformed: true }), response(frameworkResult(input)), response(frameworkResult(input))]);
    const ledger = await temporaryLedger(); const agents = createStoryAgents({ env, ledger, fetcher: mock.fetcher });
    await agents.framework(input);
    await expect(agents.framework({ ...input, operation_id: "op_framework_02" })).resolves.toBeDefined();
    expect(await ledger.used()).toBe(3);
    expect(mock.calls()).toBe(3);
  });

  it("marks malformed JSON as a schema failure after its single repair", async () => {
    const input = request(); const mock = sequence([textResponse("not-json"), textResponse("still-not-json")]);
    const ledger = await temporaryLedger(); const agents = createStoryAgents({ env, ledger, fetcher: mock.fetcher });
    await expect(agents.framework(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    expect(await ledger.used()).toBe(2);
  });

  it("automatically retries timeouts twice and preserves exhausted receipts", async () => {
    const input = request(); const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
    const mock = sequence([aborted,aborted,aborted]); const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.framework(input)).rejects.toMatchObject({ status: 504, error: { code: "request_timeout" } });
    await expect(agents.framework(input)).rejects.toMatchObject({ status: 409, error: { code: "operation_unavailable" } });
    expect(mock.calls()).toBe(3);
  });

  it("reports missing provider configuration before a request is reserved", () => {
    expect(() => createStoryAgents({ env: {} })).toThrow(StoryProviderError);
    try { createStoryAgents({ env: {} }); } catch (error) { expect((error as StoryProviderError).error.code).toBe("configuration_error"); }
  });

  it("uses a bounded configurable timeout while retaining a 180 second default", () => {
    expect(readModelConfig(env).timeoutMs).toBe(180_000);
    expect(readModelConfig({ ...env, LLM_TIMEOUT_MS: "2000" }).timeoutMs).toBe(2_000);
    expect(() => readModelConfig({ ...env, LLM_TIMEOUT_MS: "999" })).toThrow(StoryProviderError);
    expect(() => readModelConfig({ ...env, LLM_TIMEOUT_MS: "300001" })).toThrow(StoryProviderError);
  });

  it("stores only attempt telemetry and available token counts in the receipt", async () => {
    const folder = await mkdtemp(join(tmpdir(), "shuzhongren-ai-")); const path = join(folder, "model-requests.json");
    const input = request("op_framework_telemetry"); const agents = createStoryAgents({ env, ledger: new RequestLedger(path), fetcher: sequence([response(frameworkResult(input), { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 })]).fetcher });
    await agents.framework(input);
    const receipt = JSON.parse(await readFile(path, "utf8")).receipts[input.operation_id].attempts[0];
    expect(receipt).toMatchObject({ state: "success", model: "test-text-model", httpStatus: 200, usage: { promptTokens: 12, completionTokens: 34, totalTokens: 46 } });
    expect(typeof receipt.startedAt).toBe("string"); expect(typeof receipt.endedAt).toBe("string"); expect(typeof receipt.durationMs).toBe("number");
    expect(JSON.stringify(receipt)).not.toContain(input.input);
    expect(JSON.stringify(receipt)).not.toContain("test-key");
  });

  it.each([1, 2, 7])("keeps all %s dynamically proposed characters", async (count) => {
    const input = request(`op_npcs_${count}`); const mock = sequence([response(npcResult(input, count))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    const result = await agents.npcs(input);
    expect(result.characters.characters).toHaveLength(count);
    expect(mock.calls()).toBe(1);
  });

  it("rejects an NPC result that silently omits an explicitly requested count", async () => {
    const input = { ...request("op_npcs_requested"), input: "请生成 7 名角色。" };
    const mock = sequence([response(npcResult(input, 2)), response(npcResult(input, 2))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    expect(mock.calls()).toBe(2);
  });

  it("rejects an NPC result that omits an unambiguous user character clue", async () => {
    const input = { ...request("op_npcs_clue"), recognition: recognition() };
    const mock = sequence([response(npcResult(input, 1)), response(npcResult(input, 1))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    expect(mock.calls()).toBe(2);
  });

  it("covers every unambiguous clue regardless of npc or user control", async () => {
    const input = { ...request("op_npcs_npc_clue"), recognition: { ...recognition(), character_clues: [{ ...recognition().character_clues[0], controlled_by: "npc" as const }] } };
    const mock = sequence([response(npcResult(input, 1)), response(npcResult(input, 1))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
  });

  it("derives requested NPC count from common story context, not only local instruction", async () => {
    const input = { ...request("op_npcs_context_count"), input: "根据共同故事想法和已接受世界生成NPC候选", context: { story_idea: "这里只有两名核心人物。", user_notes: [] } };
    const mock = sequence([response(npcResult(input, 1)), response(npcResult(input, 1))]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
  });

  it("returns a field-only string candidate without changing unrelated state", async () => {
    const input = { ...request("op_field_title"), context: { story_idea: "一位流亡法师寻找故乡。", user_notes: ["保持克制基调"] }, field: { document: "world" as const, path: "/title" } };
    const output = { fact: { value: "灰烬归途", source: "ai_inferred", evidence: [] }, explanation: "建议标题。", warnings: [] };
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: sequence([response(output)]).fetcher });
    const result = await agents.field(input);
    expect(result.world?.title.value).toBe("灰烬归途"); expect(result.world?.title.source).toBe("ai_inferred"); expect(result.world?.story_id).toBe(input.world.story_id); expect(result.characters).toBeUndefined();
  });

  it("validates list field candidates and rejects locked or system paths before a call", async () => {
    const input = { ...request("op_field_genre"), field: { document: "world" as const, path: "/genre" } };
    const invalidList = { fact: { value: "fantasy", source: "ai_suggestion", evidence: [] }, explanation: "错误类型", warnings: [] };
    const mock = sequence([response(invalidList), response(invalidList)]); const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.field(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    const locked = { ...input, operation_id: "op_field_locked" }; locked.world = structuredClone(input.world); locked.world.title.locked = true; locked.field = { document: "world", path: "/title" };
    await expect(agents.field(locked)).rejects.toMatchObject({ status: 422 });
    await expect(agents.field({ ...input, operation_id: "op_field_system", field: { document: "world", path: "/story_id" } })).rejects.toMatchObject({ status: 422 });
  });

  it("accepts a confirmed merged character when its identity covers a user clue", async () => {
    const input = { ...request("op_npcs_merged"), recognition: recognition() };
    const candidate = npcResult(input, 1);
    candidate.characters.characters[0].name.value = "新的称谓";
    candidate.characters.characters[0].identity.value = "流亡法师";
    candidate.characters.characters[0].aliases = ["艾琳"];
    candidate.characters.characters[0].controlled_by = "user";
    const mock = sequence([response(candidate)]); const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).resolves.toMatchObject({ characters: { characters: [{ character_id: "npc_1" }] } });
  });

  it("does not restore a user-removed character from historical recognition", async () => {
    const input = { ...request("op_npcs_removed"), recognition: recognition() };
    const removal = fact("不再自动加入艾琳", "user_edited"); removal.status = "confirmed";
    input.world.prohibited_content = [{ constraint_id: "remove_eileen", text: removal, category: "must_keep" }];
    const mock = sequence([response(npcResult(input, 1))]); const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).resolves.toMatchObject({ characters: { characters: [{ character_id: "npc_1" }] } });
  });

  it("derives growth confirmation and system timestamps instead of accepting model metadata", async () => {
    const input = request("op_npcs_metadata"); const candidate = npcResult(input, 1);
    const mock = sequence([response(candidate)]); const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    const result = await agents.npcs(input);
    expect(result.characters.characters[0].growth_arc.user_confirmed).toBe(false);
    expect(typeof result.characters.characters[0].name.updated_at).toBe("string");
  });

  it("keeps timeline suggestions as candidates and rejects collisions with accepted history", async () => {
    const input = request("op_npcs_timeline");
    const existing = createTimelineEvent("既有历史"); existing.event_id = "event_existing"; input.world.timeline = [existing];
    const candidate = npcResult(input, 1);
    const conflict = createTimelineEvent("冲突历史"); conflict.event_id = "event_existing"; candidate.timeline_suggestions = [toWireTimelineEvent(conflict) as TimelineEvent];
    const mock = sequence([response(candidate), response(candidate)]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    expect(input.world.timeline).toHaveLength(1);
  });

  it("rejects a candidate history event that is later than an accepted opening", async () => {
    const input = request("op_npcs_period");
    const opening = createTimelineEvent("开局"); opening.event_id = "event_opening"; opening.period = "opening"; opening.order = 2;
    input.world.timeline = [opening];
    const candidate = npcResult(input, 1);
    const lateHistory = createTimelineEvent("过晚历史"); lateHistory.event_id = "event_history_late"; lateHistory.period = "history"; lateHistory.order = 3;
    candidate.timeline_suggestions = [toWireTimelineEvent(lateHistory) as TimelineEvent];
    const mock = sequence([response(candidate), response(candidate)]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.npcs(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
  });

  it("prevents a timeline revision from rewriting a non-timeline world field", async () => {
    const input = { ...request("op_revise_timeline"), target: "timeline" as const };
    const changed = structuredClone(input.world); changed.title.value = "被改写的标题";
    const output = { world: toWireWorld(changed), warnings: [], assistant_message: "已修改。" };
    const mock = sequence([response(output), response(output)]);
    const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: mock.fetcher });
    await expect(agents.revise(input)).rejects.toMatchObject({ status: 422, error: { code: "schema_error" } });
    expect(mock.calls()).toBe(2);
  });
});


it("supplies the full NPC container schema and gives a precise repair for a flattened array", async () => {
  const input = request("op_npc_wrapper_fix"), valid = npcResult(input, 1);
  const wrong = { ...valid, characters: (valid.characters as unknown as { characters: unknown[] }).characters };
  const recorded = recording([response(wrong), response(valid)]);
  const agents = createStoryAgents({ env, ledger: await temporaryLedger(), fetcher: recorded.fetcher });
  expect((await agents.npcs(input)).characters.characters).toHaveLength(1);
  const first = recorded.requests[0] as { messages: { content: string }[] }, second = recorded.requests[1] as { messages: { content: string }[] };
  expect(first.messages[0].content).toContain('"relationships"');
  expect(first.messages[0].content).toContain('NOT an array');
  expect(second.messages[1].content).toContain('/characters: expected {characters: [...], relationships: [...]}, not an array');
});

it("matches first-person clues to one named user character instead of requiring a character named 我", async () => {
  const input = request("op_first_person");
  input.recognition={summary:"我要当大侠",character_clues:[{label:"我",identity:"主角，未来大侠",evidence:["我要当大侠"],existing_character_id:null,controlled_by:"user",ambiguity:null}],hard_constraints:[],ambiguities:[],questions:[]};
  const profiles=npcProfiles(input,2);profiles.characters[0].controlled_by="user";profiles.characters[0].name=fact("林青");
  const mock=sequence([response({characters:toWireCharacters(profiles),timeline_suggestions:[],warnings:[],assistant_message:"人物"})]);
  const agents=createStoryAgents({env,ledger:await temporaryLedger(),fetcher:mock.fetcher});
  expect((await agents.npcs(input)).characters.characters[0].name.value).toBe("林青");
  expect(mock.calls()).toBe(1);
});


it("repairs NPC relationship indexes and retains omitted existing people without a model repair", async () => {
  const input=request("op_local_indexes");
  const old=createCharacter("旧人物","npc_old"), other=createCharacter("同伴","npc_other");
  const relationship=createRelationship(old.character_id,other.character_id);
  old.relationship_ids=[relationship.relationship_id];other.relationship_ids=[relationship.relationship_id];
  input.characters.characters=[old,other];input.characters.relationships=[relationship];
  const profiles=npcProfiles(input,1);profiles.characters.push(structuredClone(other));
  profiles.characters[1].relationship_ids=[];
  const mock=sequence([response({...npcResult(input,1),characters:toWireCharacters(profiles)})]);
  const result=await createStoryAgents({env,ledger:await temporaryLedger(),fetcher:mock.fetcher}).npcs(input);
  expect(mock.calls()).toBe(1);
  expect(result.characters.characters.find(c=>c.character_id===old.character_id)).toEqual(old);
  expect(result.characters.characters.find(c=>c.character_id===other.character_id)?.relationship_ids).toEqual([relationship.relationship_id]);
  expect(result.characters.relationships).toEqual([relationship]);
  expect(validateCharacters(result.characters)).toEqual([]);
});

it("does not invent a missing relationship endpoint to bypass validation", async () => {
  const input=request("op_bad_endpoint"),profiles=npcProfiles(input,1);
  profiles.relationships=[createRelationship("npc_1","npc_missing")];
  const output={...npcResult(input,1),characters:toWireCharacters(profiles)};
  const mock=sequence([response(output),response(output)]);
  await expect(createStoryAgents({env,ledger:await temporaryLedger(),fetcher:mock.fetcher}).npcs(input)).rejects.toBeInstanceOf(StoryProviderError);
  expect(mock.calls()).toBe(2);
});
