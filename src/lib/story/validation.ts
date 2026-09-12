import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import common from "../../../schemas/common.schema.json";
import worldSchema from "../../../schemas/story-world.schema.json";
import charactersSchema from "../../../schemas/character-profiles.schema.json";
import type { CharacterProfiles, StoryWorld, ValidationIssue } from "./contracts";
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(common);
const checkWorld = ajv.compile<StoryWorld>(worldSchema);
const checkCharacters = ajv.compile<CharacterProfiles>(charactersSchema);
const checkTimeline = ajv.compile({ $ref: worldSchema.$id + "#/$defs/timelineEvent" });
export const isTimelineEvent = (value: unknown): boolean => !!checkTimeline(value);
function structural(check: typeof checkWorld | typeof checkCharacters, value: unknown): ValidationIssue[] {
  if (check(value)) return [];
  return (check.errors ?? []).map(e => ({ code: "SCHEMA_INVALID", path: e.instancePath || "/", message: (e.message ?? "数据结构不符合规范") + (e.params.missingProperty ? ": " + e.params.missingProperty : "") }));
}
export const validateWorld = (value: unknown) => structural(checkWorld, value);
export const validateCharacters = (value: unknown) => structural(checkCharacters, value);
export function isFact(value: unknown): value is { value: unknown; status: string; source: string; locked: boolean; evidence: string[]; updated_at: string } {
  return !!value && typeof value === "object" && "value" in value && "source" in value && "status" in value && "locked" in value;
}
export function walkFacts(value: unknown, fn: (fact: ReturnType<typeof asFact>, path: string) => void, path = ""): void {
  if (isFact(value)) { fn(value, path); return; }
  if (Array.isArray(value)) value.forEach((v, i) => walkFacts(v, fn, path + "/" + i));
  else if (value && typeof value === "object") Object.entries(value).forEach(([k,v]) => walkFacts(v, fn, path + "/" + k));
}
function asFact(value: unknown) { if (!isFact(value)) throw new Error("Not a fact"); return value; }
export function validatePair(world: StoryWorld, characters: CharacterProfiles): ValidationIssue[] {
  const issues = [...validateWorld(world).map(i => ({...i,path:"/world"+i.path})), ...validateCharacters(characters).map(i => ({...i,path:"/characters"+i.path}))];
  if (issues.length) return issues;
  const add = (code: string,path: string,message: string) => issues.push({code,path,message});
  if (world.story_id !== characters.story_id) add("STORY_MISMATCH","/story_id","世界与人物不属于同一故事。");
  const ids = new Set<string>();
  for (const [prefix, list, key] of [
    ["/world/setting/locations", world.setting.locations, "location_id"], ["/world/setting/world_rules", world.setting.world_rules, "rule_id"],
    ["/world/organizations", world.organizations, "organization_id"], ["/world/timeline", world.timeline, "event_id"],
    ["/world/initial_outline",world.initial_outline,"beat_id"], ["/characters/characters", characters.characters,"character_id"],
    ["/characters/relationships", characters.relationships,"relationship_id"]
  ] as const) {
    list.forEach((item,i) => { const id = (item as unknown as Record<string,string>)[key]; if(ids.has(id)) add("DUPLICATE_ID",prefix+"/"+i,"重复标识："+id); ids.add(id); });
  }
  const npcIds = new Set(characters.characters.map(c=>c.character_id));
  const locationIds = new Set(world.setting.locations.map(c=>c.location_id));
  const eventIds = new Set(world.timeline.map(e=>e.event_id));
  const rels = new Map(characters.relationships.map(r=>[r.relationship_id,r]));
  characters.relationships.forEach((r,i)=>{
    if(!npcIds.has(r.from_character_id)||!npcIds.has(r.to_character_id)) add("DANGLING_RELATION","/characters/relationships/"+i,"关系引用了不存在的人物。");
    if(r.from_character_id===r.to_character_id) add("SELF_RELATION","/characters/relationships/"+i,"关系不能指向同一个人物。");
    for(const id of [r.from_character_id,r.to_character_id]) if(!characters.characters.find(c=>c.character_id===id)?.relationship_ids.includes(r.relationship_id)) add("MISSING_RELATION_BACKREF","/characters/relationships/"+i,"人物没有引用这条关系。");
  });
  characters.characters.forEach((c,i)=>{
    for(const id of c.relationship_ids) { const r=rels.get(id); if(!r || (r.from_character_id!==c.character_id&&r.to_character_id!==c.character_id)) add("DANGLING_RELATION","/characters/characters/"+i+"/relationship_ids","无效关系引用："+id); }
    for(const id of c.timeline_event_ids) if(!eventIds.has(id)) add("DANGLING_EVENT","/characters/characters/"+i+"/timeline_event_ids","人物前史引用了不存在的事件："+id);
    const g=c.growth_arc; const expected=[g.starting_state,g.pressure_point,g.possible_direction].every(f=>f.status==="confirmed");
    if(g.user_confirmed!==expected) add("GROWTH_CONFIRMATION","/characters/characters/"+i+"/growth_arc","成长方向确认状态不一致。");
  });
  const events = new Map(world.timeline.map(e=>[e.event_id,e]));
  const openingOrders = world.timeline.filter(e=>e.period==="opening"&&e.order!==null).map(e=>e.order as number);
  if(openingOrders.length)for(const e of world.timeline)if(e.period==="history"&&e.order!==null&&e.order>Math.min(...openingOrders))add("TIME_PERIOD_CONFLICT","/world/timeline","历史事件的顺序晚于已确定的开局时点。");
  world.timeline.forEach((e,i)=>{
    const p="/world/timeline/"+i;
    for(const id of e.related_character_ids) if(!npcIds.has(id)) add("DANGLING_CHARACTER",p,"事件引用了不存在的人物："+id);
    for(const id of e.related_location_ids) if(!locationIds.has(id)) add("DANGLING_LOCATION",p,"事件引用了不存在的地点："+id);
    for(const id of e.after_event_ids) {
      const before=events.get(id);
      if(!before) add("DANGLING_EVENT",p,"先后关系引用了不存在的事件："+id);
      else if(before.order!==null&&e.order!==null&&before.order>=e.order) add("TIME_ORDER_CONFLICT",p,"事件的排序与先后依赖矛盾。");
      if(before?.period==="opening"&&e.period==="history") add("TIME_PERIOD_CONFLICT",p,"历史事件不能晚于开局事件。");
    }
  });
  const visiting=new Set<string>(), visited=new Set<string>();
  function visit(id:string):boolean { if(visiting.has(id))return true; if(visited.has(id))return false; visiting.add(id); for(const parent of events.get(id)?.after_event_ids??[])if(events.has(parent)&&visit(parent))return true; visiting.delete(id);visited.add(id);return false; }
  for(const id of eventIds) if(visit(id)){add("TIME_CYCLE","/world/timeline","事件先后关系存在循环。");break;}
  for(const [key,doc] of [["world",world],["characters",characters]] as const) walkFacts(doc,(f,p)=>{
    if(f.status==="confirmed" && (typeof f.value==="string" ? !f.value.trim() : Array.isArray(f.value)&&f.value.length===0)) add("EMPTY_CONFIRMED","/"+key+p,"空白内容不能标记为已确认。");
  });
  return issues;
}
function entityId(value:unknown):string|undefined {
  if(!value||typeof value!=="object")return;
  for(const [key,id] of Object.entries(value))if(key.endsWith("_id")&&typeof id==="string")return id;
}
export function lockedChanges(before:unknown,after:unknown,path=""):ValidationIssue[] {
  if(isFact(before)) return before.locked && (!isFact(after)||JSON.stringify(before)!==JSON.stringify(after)) ? [{code:"LOCKED_CHANGE",path,message:"已锁定设定不能被覆盖，请先明确解锁。"}] : [];
  if(Array.isArray(before)) return before.flatMap((item,i)=>{const id=entityId(item);const target=Array.isArray(after)?(id?after.find(v=>entityId(v)===id):after[i]):undefined;return lockedChanges(item,target,path+"/"+i);});
  if(before&&typeof before==="object")return Object.entries(before).flatMap(([k,v])=>lockedChanges(v,after&&typeof after==="object"?(after as Record<string,unknown>)[k]:undefined,path+"/"+k));
  return [];
}
