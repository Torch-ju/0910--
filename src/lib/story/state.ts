import type { Candidate, DocumentKind, FactStatus, StorySnapshot, ValidationIssue } from "./contracts";
import { fact, now, uid } from "./factory";
import { isFact, lockedChanges, validatePair, walkFacts } from "./validation";
export class StoryError extends Error {
  constructor(public code: string, message: string, public issues: ValidationIssue[] = []) { super(message); }
}
export function atPath(root: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) throw new StoryError("INVALID_PATH","字段路径无效。");
  let value = root;
  for (const part of pointer.slice(1).split("/").map(x=>x.replaceAll("~1","/").replaceAll("~0","~"))) {
    if (["__proto__","prototype","constructor"].includes(part) || !value || typeof value!=="object" || !Object.hasOwn(value,part)) throw new StoryError("INVALID_PATH","字段已不存在，请刷新当前卡片。");
    value=(value as Record<string,unknown>)[part];
  }
  return value;
}
export function syncGrowth(snapshot: StorySnapshot) {
  for(const c of snapshot.characters.characters) c.growth_arc.user_confirmed=[c.growth_arc.starting_state,c.growth_arc.pressure_point,c.growth_arc.possible_direction].every(f=>f.status==="confirmed");
}
export function mutateSnapshot(snapshot: StorySnapshot, operationId: string, fingerprint: string, summary: string, mutate: (next:StorySnapshot)=>void, baseRevision = snapshot.snapshot_revision, protectLocked = true): StorySnapshot {
  const prior=snapshot.operations.find(o=>o.operation_id===operationId);
  if(prior){if(prior.fingerprint!==fingerprint)throw new StoryError("OPERATION_CONFLICT","同一操作标识不能用于不同修改。");return snapshot;}
  if(baseRevision!==snapshot.snapshot_revision)throw new StoryError("STALE_REVISION","故事已经有新的修改，这份旧结果不能覆盖当前设定。");
  const next=structuredClone(snapshot);
  mutate(next); syncGrowth(next);
  const issues=validatePair(next.world,next.characters);
  if(protectLocked)issues.push(...lockedChanges(snapshot.world,next.world,"/world"),...lockedChanges(snapshot.characters,next.characters,"/characters"));
  if(issues.length)throw new StoryError("INVALID_CHANGE",issues[0].message,issues);
  if(next.world.story_id!==snapshot.world.story_id)throw new StoryError("STORY_MISMATCH","不能替换当前故事标识。");
  const revision=snapshot.snapshot_revision+1,stamp=now();
  next.snapshot_revision=revision;next.updated_at=stamp;
  for(const doc of [next.world,next.characters]){
    doc.revision=revision;doc.updated_at=stamp;
    doc.change_log.push({change_id:uid("change"),changed_at:stamp,actor:"user",summary,changed_paths:["/"],operation_id:operationId,previous_revision:snapshot.snapshot_revision,new_revision:revision});
  }
  next.operations.push({operation_id:operationId,fingerprint,revision});
  return next;
}
export function editFact(snapshot:StorySnapshot,doc:DocumentKind,path:string,value:string|string[]):StorySnapshot {
  const previous=atPath(snapshot[doc],path);
  if(isFact(previous)&&JSON.stringify(previous.value)===JSON.stringify(value))return snapshot;
  return mutateSnapshot(snapshot,uid("op"),JSON.stringify({doc,path,value}),"用户修改设定",next=>{
    const f=atPath(next[doc],path);
    if(!isFact(f))throw new StoryError("INVALID_PATH","该字段不是可编辑设定。");
    if(f.locked)throw new StoryError("LOCKED_CHANGE","请先解除该设定的锁定。");
    if(Array.isArray(f.value)!==Array.isArray(value))throw new StoryError("TYPE_MISMATCH","字段类型与原设定不符。");
    f.value=value;f.source="user_edited";f.status=value.length?"pending_confirmation":"draft";f.evidence=[Array.isArray(value)?value.join("、"):value];f.updated_at=now();
  });
}
export function setFactStatus(snapshot:StorySnapshot,doc:DocumentKind,path:string,status:FactStatus):StorySnapshot {
  const previous=atPath(snapshot[doc],path);
  if(isFact(previous)&&previous.status===status)return snapshot;
  return mutateSnapshot(snapshot,uid("op"),JSON.stringify({doc,path,status}),"用户更新确认状态",next=>{
    const f=atPath(next[doc],path);
    if(!isFact(f))throw new StoryError("INVALID_PATH","该字段不是设定。");
    if(f.locked)throw new StoryError("LOCKED_CHANGE","请先解锁后改变确认状态。");
    if(status==="confirmed" && (typeof f.value==="string"?!f.value.trim():Array.isArray(f.value)&&!f.value.length))throw new StoryError("EMPTY_CONFIRMED","请先补充内容，再确认。");
    f.status=status;f.updated_at=now();
  });
}
function objectId(value:unknown):string|undefined {
  if(!value||typeof value!=="object")return;
  return Object.entries(value).find(([k,v])=>k.endsWith("_id")&&typeof v==="string")?.[1] as string|undefined;
}
export function reconcileIncoming(incoming: unknown, previous: unknown, evidenceText: string): unknown {
  if(isFact(incoming)){
    if(isFact(previous)&&JSON.stringify(previous.value)===JSON.stringify(incoming.value))return structuredClone(previous);
    const evidence=Array.isArray(incoming.evidence)?incoming.evidence.filter(q=>typeof q==="string"&&q.trim()&&evidenceText.includes(q)):[];
    return {...incoming,source:incoming.source==="user_explicit"&&evidence.length?"user_explicit":incoming.source==="ai_inferred"?"ai_inferred":"ai_suggestion",status:typeof incoming.value==="string"?!incoming.value.trim()?"draft":"pending_confirmation":Array.isArray(incoming.value)&&!incoming.value.length?"draft":"pending_confirmation",locked:false,evidence,updated_at:now()};
  }
  if(Array.isArray(incoming))return incoming.map((v,i)=>{const id=objectId(v);const old=Array.isArray(previous)?id?previous.find(o=>objectId(o)===id):previous[i]:undefined;return reconcileIncoming(v,old,evidenceText);});
  if(incoming&&typeof incoming==="object")return Object.fromEntries(Object.entries(incoming).map(([k,v])=>[k,reconcileIncoming(v,previous&&typeof previous==="object"?(previous as Record<string,unknown>)[k]:undefined,evidenceText)]));
  return incoming;
}
export function acceptCandidate(snapshot:StorySnapshot,candidate:Candidate):StorySnapshot {
  return mutateSnapshot(snapshot,candidate.operation_id,candidate.fingerprint,candidate.summary,next=>{
    next.world=structuredClone(candidate.world);next.characters=structuredClone(candidate.characters);
    next.recognition=candidate.recognition;next.timeline_suggestions=structuredClone(candidate.timeline_suggestions);
  },candidate.base_revision);
}
export function removeCharacter(snapshot:StorySnapshot,id:string):StorySnapshot {
  return mutateSnapshot(snapshot,uid("op"),"remove:"+id,"删除人物并清理关联",next=>{
    const removed=next.characters.characters.find(c=>c.character_id===id);
    if(!removed)throw new StoryError("NOT_FOUND","人物已不存在。");
    next.world.prohibited_content.push({constraint_id:uid("constraint"),category:"avoid",text:{...fact("用户已移除人物「"+removed.name.value+"」（"+id+"），未经用户明确要求，不再自动加入。","user_edited"),status:"confirmed"}});
    next.characters.characters=next.characters.characters.filter(c=>c.character_id!==id);
    next.characters.relationships=next.characters.relationships.filter(r=>r.from_character_id!==id&&r.to_character_id!==id);
    const relIds=new Set(next.characters.relationships.map(r=>r.relationship_id));
    for(const c of next.characters.characters)c.relationship_ids=c.relationship_ids.filter(r=>relIds.has(r));
    for(const e of next.world.timeline)e.related_character_ids=e.related_character_ids.filter(n=>n!==id);
    next.timeline_suggestions=next.timeline_suggestions.map(e=>({...e,related_character_ids:e.related_character_ids.filter(n=>n!==id)}));
  });
}
export function mergeCharacters(snapshot:StorySnapshot,sourceId:string,targetId:string):StorySnapshot {
  if(sourceId===targetId)throw new StoryError("MERGE_SELF","请选择两个不同的人物。");
  return mutateSnapshot(snapshot,uid("op"),"merge:"+sourceId+":"+targetId,"合并人物，目标设定保留并记录歧义",next=>{
    const source=next.characters.characters.find(c=>c.character_id===sourceId),target=next.characters.characters.find(c=>c.character_id===targetId);
    if(!source||!target)throw new StoryError("NOT_FOUND","合并的人物已不存在。");
    target.aliases=[...new Set([...target.aliases,...source.aliases,source.name.value])].filter(v=>v&&v!==target.name.value);
    if(source.controlled_by==="user")target.controlled_by="user";
    walkFacts(source,(f,p)=>{
      if(p==="/name"||p.startsWith("/change_log")||p.startsWith("/open_questions"))return;
      let old;try{old=atPath(target,p);}catch{return;}
      if(!isFact(old))return;
      const a=JSON.stringify(f.value),b=JSON.stringify(old.value);
      if(a===b||f.status==="rejected"||(typeof f.value==="string"?!f.value.trim():Array.isArray(f.value)&&!f.value.length))return;
      if((typeof old.value==="string"?!old.value.trim():Array.isArray(old.value)&&!old.value.length)&&!old.locked)Object.assign(old,structuredClone(f),{source:"user_edited",updated_at:now()});
      else target.open_questions.push({question_id:uid("question"),question:"合并人物后需确认 "+p+"：保留「"+String(old.value)+"」，原人物为「"+String(f.value)+"」。",importance:"medium",blocking:false,status:"open",answer:null});
    });
    target.timeline_event_ids=[...new Set([...target.timeline_event_ids,...source.timeline_event_ids])];
    next.characters.characters=next.characters.characters.filter(c=>c.character_id!==sourceId);
    for(const r of next.characters.relationships){if(r.from_character_id===sourceId)r.from_character_id=targetId;if(r.to_character_id===sourceId)r.to_character_id=targetId;}
    next.characters.relationships=next.characters.relationships.filter(r=>r.from_character_id!==r.to_character_id);
    for(const c of next.characters.characters)c.relationship_ids=next.characters.relationships.filter(r=>r.from_character_id===c.character_id||r.to_character_id===c.character_id).map(r=>r.relationship_id);
    for(const e of [...next.world.timeline,...next.timeline_suggestions])e.related_character_ids=[...new Set(e.related_character_ids.map(id=>id===sourceId?targetId:id))];
  });
}
export function confirmSnapshot(snapshot:StorySnapshot):StorySnapshot {
  const clarification=snapshot.recognition?.questions.find(q=>q.blocking);
  if(clarification)throw new StoryError("OPEN_QUESTIONS","请先回答关键问题："+clarification.question);
  const blocking=[...snapshot.world.open_questions,...snapshot.characters.characters.flatMap(c=>c.open_questions)].filter(q=>q.blocking&&q.status==="open");
  if(blocking.length)throw new StoryError("OPEN_QUESTIONS","请先回答关键问题："+blocking[0].question);
  if(!snapshot.world.title.value.trim())throw new StoryError("EMPTY_WORLD","请先补充或生成故事世界。");
  if(!snapshot.world.timeline.some(e=>e.period==="opening"))throw new StoryError("MISSING_OPENING","初始时间线需要一个故事开局时点。");
  return mutateSnapshot(snapshot,uid("op"),"confirm:"+snapshot.snapshot_revision,"用户确认当前非空且未拒绝的基础设定",next=>{
    for(const doc of [next.world,next.characters])walkFacts(doc,f=>{
      if(!f.locked&&f.status!=="rejected"&&(typeof f.value==="string"?!!f.value.trim():Array.isArray(f.value)&&f.value.length>0)){f.status="confirmed";f.updated_at=now();}
    });
  });
}
