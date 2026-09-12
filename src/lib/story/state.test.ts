import { describe, expect, it } from "vitest";
import { createCharacter, createRelationship, createSnapshot, createTimelineEvent, fact, uid } from "./factory";
import { acceptCandidate, confirmSnapshot, editFact, mergeCharacters, mutateSnapshot, removeCharacter, setFactStatus } from "./state";
import { lockedChanges, validatePair } from "./validation";
import { deserializeWorkspace, exportDocument, serializeWorkspace } from "./storage";
import type { Candidate, StorySnapshot } from "./contracts";
function fixture(count=2):StorySnapshot {
  const s=createSnapshot("eastern_wuxia");s.world.title=fact("雪落青崖");s.world.logline=fact("一封旧信牵出山门往事");
  const event=createTimelineEvent("山门封闭");event.period="history";event.time_label=fact("开局三年前");event.order=0;
  const opening=createTimelineEvent("来信抵达");opening.period="opening";opening.time_label=fact("开局之日");opening.order=1;opening.after_event_ids=[event.event_id];
  s.world.timeline=[event,opening];
  s.characters.characters=Array.from({length:count},(_,i)=>createCharacter("人物"+(i+1)));
  if(count>1){const [a,b]=s.characters.characters;const r=createRelationship(a.character_id,b.character_id);s.characters.relationships=[r];a.relationship_ids=[r.relationship_id];b.relationship_ids=[r.relationship_id];a.timeline_event_ids=[event.event_id];event.related_character_ids=[a.character_id];}
  return s;
}
function candidate(s:StorySnapshot):Candidate {return {operation_id:uid("op"),base_revision:s.snapshot_revision,fingerprint:"example",world:structuredClone(s.world),characters:structuredClone(s.characters),timeline_suggestions:[],recognition:null,summary:"候选修改",warnings:[]};}
describe("story contracts and state",()=>{
  it.each([0,1,2,7])("validates %i NPCs without a fixed schema cardinality",count=>{const s=fixture(count);expect(validatePair(s.world,s.characters)).toEqual([]);});
  it("rejects absent required schema metadata with a field path",()=>{const s=fixture();delete (s.world.title as Partial<typeof s.world.title>).source;expect(validatePair(s.world,s.characters).some(i=>i.path.includes("/title"))).toBe(true);});
  it("does not allow confirmed blank content",()=>{const s=fixture();expect(()=>setFactStatus(s,"world","/summary","confirmed")).toThrow("补充");});
  it("preserves IDs during rename and records a paired revision",()=>{const s=fixture();const id=s.characters.characters[0].character_id;const next=editFact(s,"characters","/characters/0/name","沈照");expect(next.characters.characters[0].character_id).toBe(id);expect(next.characters.revision).toBe(2);expect(next.world.revision).toBe(2);expect(next.characters.characters[0].name.source).toBe("user_edited");expect(s.characters.characters[0].name.value).toBe("人物1");});
  it("blocks modification or removal of locked facts",()=>{const s=fixture();s.characters.characters[0].name.locked=true;expect(()=>editFact(s,"characters","/characters/0/name","改名")).toThrow(expect.objectContaining({code:"LOCKED_CHANGE"}));expect(()=>removeCharacter(s,s.characters.characters[0].character_id)).toThrow("锁定");});
  it("checks locks by entity ID rather than array index",()=>{const s=fixture();s.characters.characters[0].name.locked=true;const after=structuredClone(s.characters);after.characters.reverse();expect(lockedChanges(s.characters,after)).toEqual([]);});
  it("replays the same operation without another revision and rejects reuse with different content",()=>{const s=fixture(),id=uid("op");const next=mutateSnapshot(s,id,"one","test",n=>{n.world.summary=fact("摘要");});expect(mutateSnapshot(next,id,"one","retry",()=>{throw Error("must not run");})).toBe(next);expect(()=>mutateSnapshot(next,id,"two","collision",()=>{})).toThrow("标识");});
  it("blocks an old model result after local edits",()=>{const s=fixture();const c=candidate(s);const next=editFact(s,"world","/summary","新的摘要");expect(()=>acceptCandidate(next,c)).toThrow("旧结果");});
  it("removes all references when deleting an unlocked NPC",()=>{const s=fixture(),id=s.characters.characters[0].character_id;const next=removeCharacter(s,id);expect(next.characters.relationships).toHaveLength(0);expect(next.world.timeline[0].related_character_ids).not.toContain(id);expect(validatePair(next.world,next.characters)).toEqual([]);});
  it("merges IDs and references while keeping target values",()=>{const s=fixture();s.characters.characters[0].identity=fact("剑客");s.characters.characters[1].identity=fact("药师");const next=mergeCharacters(s,s.characters.characters[0].character_id,s.characters.characters[1].character_id);expect(next.characters.characters).toHaveLength(1);expect(next.characters.characters[0].identity.value).toBe("药师");expect(next.characters.characters[0].open_questions.length).toBeGreaterThan(0);expect(validatePair(next.world,next.characters)).toEqual([]);});
  it("detects dangling NPC/event references",()=>{const s=fixture();s.characters.characters[0].timeline_event_ids.push("event_missing");expect(validatePair(s.world,s.characters).some(i=>i.code==="DANGLING_EVENT")).toBe(true);});
  it("detects temporal cycles and ordering contradictions",()=>{const s=fixture();s.world.timeline[0].after_event_ids=[s.world.timeline[1].event_id];const codes=validatePair(s.world,s.characters).map(i=>i.code);expect(codes).toContain("TIME_CYCLE");expect(codes).toContain("TIME_ORDER_CONFLICT");expect(codes).toContain("TIME_PERIOD_CONFLICT");});
  it("keeps fictional time text and rejects future periods",()=>{const s=fixture();s.world.timeline[0].time_label=fact("旧朝覆灭后三十年");expect(validatePair(s.world,s.characters)).toEqual([]);(s.world.timeline[0] as {period:string}).period="future";expect(validatePair(s.world,s.characters).some(i=>i.code==="SCHEMA_INVALID")).toBe(true);});
  it("confirmation preserves provenance and rejected values",()=>{const s=fixture();s.world.summary=fact("不采用的背景");s.world.summary.status="rejected";const next=confirmSnapshot(s);expect(next.world.title.source).toBe("ai_suggestion");expect(next.world.title.status).toBe("confirmed");expect(next.world.summary.status).toBe("rejected");expect(next.world.setting.era.status).toBe("draft");});
  it("blocks confirmation when a critical question remains",()=>{const s=fixture();s.world.open_questions.push({question_id:uid("question"),question:"开局发生在哪一年？",importance:"high",blocking:true,status:"open",answer:null});expect(()=>confirmSnapshot(s)).toThrow("关键问题");});
  it("blocks dangerous or missing edit paths",()=>{const s=fixture();expect(()=>editFact(s,"world","/__proto__/value","x")).toThrow(expect.objectContaining({code:"INVALID_PATH"}));expect(()=>editFact(s,"world","/missing","x")).toThrow(expect.objectContaining({code:"INVALID_PATH"}));});
});
describe("workspace persistence",()=>{
  it("roundtrips both documents and conversation in a single envelope",()=>{const s=fixture();s.input="一个模糊想法";const raw=serializeWorkspace({version:1,current:s,previous:null,candidate:null,pending:null,saved_at:new Date().toISOString()});expect(deserializeWorkspace(raw).current).toEqual(s);});
  it("rejects mismatched stories or revisions instead of restoring partial state",()=>{const s=fixture();s.characters.story_id="story_other";expect(()=>serializeWorkspace({version:1,current:s,previous:null,candidate:null,pending:null,saved_at:new Date().toISOString()})).toThrow();});
  it("rejects malformed persisted data",()=>expect(()=>deserializeWorkspace('{"version":1,"current":null}')).toThrow());
  it("exports the actual valid paired snapshot",()=>{const s=fixture(7);const world=JSON.parse(exportDocument(s,"world"));const characters=JSON.parse(exportDocument(s,"characters"));expect(world.story_id).toBe(characters.story_id);expect(characters.characters).toHaveLength(7);});
});
