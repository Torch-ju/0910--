import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { prepareCandidate } from "./candidate";
import { getFieldContract } from "./field-contract";
import { createCharacter, createSnapshot, fact, uid } from "./factory";
import { acceptCandidate, editFact, mutateSnapshot, setFactStatus } from "./state";
import type { Candidate, StorySnapshot } from "./contracts";

function proposal(s: StorySnapshot): Candidate {
  return { operation_id: uid("op"), base_revision: s.snapshot_revision, fingerprint: "co-create", world: structuredClone(s.world), characters: structuredClone(s.characters), timeline_suggestions: [], recognition: null, summary: "字段建议", warnings: [], origin: "field", base: { world: structuredClone(s.world), characters: structuredClone(s.characters), story_idea: s.input, preset_id: s.preset_id, timeline_suggestions: [] } };
}
describe("candidate co-creation", () => {
  it("does not invalidate a candidate on a no-op edit or unchanged status", () => {
    const s = createSnapshot();
    expect(editFact(s, "world", "/summary", "")).toBe(s);
    expect(setFactStatus(s, "world", "/summary", "draft")).toBe(s);
  });
  it("merges an unrelated newer user edit and keeps paired revisions", () => {
    const s = createSnapshot(); s.input = "江湖中的一封旧信";
    const c = proposal(s); c.world.themes = fact(["信任与背叛"]);
    const current = editFact(s, "world", "/title", "不改这个标题");
    const prepared = prepareCandidate(current, c);
    expect(prepared.issues).toEqual([]);
    const next = acceptCandidate(current, prepared.candidate);
    expect(next.world.title.value).toBe("不改这个标题");
    expect(next.world.themes.value).toEqual(["信任与背叛"]);
    expect(next.world.revision).toBe(next.characters.revision);
  });
  it("reports a precise same-field conflict and retains user content", () => {
    const s = createSnapshot(), c = proposal(s); c.world.summary = fact("AI 摘要");
    const current = editFact(s, "world", "/summary", "用户新摘要");
    const result = prepareCandidate(current, c);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "EDIT_CONFLICT", path: "/world/summary" }));
    expect(result.candidate.world.summary.value).toBe("用户新摘要");
  });
  it("detects a changed shared story idea even when the revision did not increment", () => {
    const s = createSnapshot(); s.input = "西方港口"; const c = proposal(s);
    const result = prepareCandidate({ ...s, input: "东方山门" }, c);
    expect(result.issues.some(i => i.code === "STORY_CONTEXT_CHANGED")).toBe(true);
  });
  it("uses stable entity IDs when NPC order changes", () => {
    const s = createSnapshot(); s.characters.characters = [createCharacter("甲"), createCharacter("乙")];
    const c = proposal(s); c.characters.characters[0].desire = fact("寻找旧信");
    const current = mutateSnapshot(s, uid("op"), "reorder", "排序", next => { next.characters.characters.reverse(); });
    const result = prepareCandidate(current, c);
    expect(result.issues).toEqual([]);
    expect(result.candidate.characters.characters.find(v => v.name.value === "甲")?.desire.value).toBe("寻找旧信");
    expect(result.candidate.characters.characters[0].name.value).toBe("乙");
  });
  it("does not resurrect a deleted NPC or overwrite a newly locked field", () => {
    const s = createSnapshot(); s.characters.characters = [createCharacter("甲")];
    const c = proposal(s); c.characters.characters[0].desire = fact("寻找旧信");
    const current = mutateSnapshot(s, uid("op"), "remove", "删除", next => { next.characters.characters = []; });
    expect(prepareCandidate(current, c).issues.some(i => i.code === "DELETED_ENTITY_CONFLICT")).toBe(true);
    const world = createSnapshot(), worldProposal = proposal(world); worldProposal.world.summary = fact("建议");
    const locked = mutateSnapshot(world, uid("op"), "lock", "锁定", next => { next.world.summary.locked = true; }, world.snapshot_revision, false);
    expect(prepareCandidate(locked, worldProposal).issues.length).toBeGreaterThan(0);
  });
  it("explains why an old saved candidate without a baseline cannot be merged", () => {
    const s = createSnapshot(), c = proposal(s); delete c.base;
    const current = editFact(s, "world", "/title", "新标题");
    expect(prepareCandidate(current, c).issues[0].code).toBe("LEGACY_CANDIDATE_STALE");
  });
});
describe("public-schema-derived field contracts", () => {
  it("uses different task prompts and exact value types for theme and summary", () => {
    const s = createSnapshot(), ajv = new Ajv2020();
    const theme = getFieldContract(s.world, s.characters, { document: "world", path: "/themes" });
    const summary = getFieldContract(s.world, s.characters, { document: "world", path: "/summary" });
    expect(theme.task).not.toBe(summary.task);
    const valid = ajv.compile(theme.schema);
    expect(valid({ fact: { value: ["选择"], source: "ai_suggestion", evidence: [] }, explanation: "主题依据", warnings: [] })).toBe(true);
    expect(valid({ fact: { value: "错误字符串", source: "ai_suggestion", evidence: [] }, explanation: "", warnings: [] })).toBe(false);
    expect(valid({ fact: { value: ["选择"], source: "ai_suggestion", evidence: [], locked: true }, explanation: "", warnings: [] })).toBe(false);
  });
  it("resolves NPC desire through array and local schema references", () => {
    const s = createSnapshot(); s.characters.characters = [createCharacter()];
    const contract = getFieldContract(s.world, s.characters, { document: "characters", path: "/characters/0/desire" });
    expect(contract.task).toContain("个人化");
  });
  it("refuses system identifiers, locked fields and unsafe pointers", () => {
    const s = createSnapshot();
    expect(() => getFieldContract(s.world, s.characters, { document: "world", path: "/story_id" })).toThrow();
    expect(() => getFieldContract(s.world, s.characters, { document: "world", path: "/__proto__/x" })).toThrow();
    s.world.title.locked = true;
    expect(() => getFieldContract(s.world, s.characters, { document: "world", path: "/title" })).toThrow("解锁");
  });
});
