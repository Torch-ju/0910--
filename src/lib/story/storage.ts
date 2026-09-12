import type { AgentEndpoint, AgentRequest, Candidate, StorySnapshot } from "./contracts";
import { isTimelineEvent, validatePair } from "./validation";
export const STORAGE_KEY="shuzhongren.workspace.v1";
export type PendingRequest={endpoint:AgentEndpoint;body:AgentRequest;fingerprint:string};
export type SavedWorkspace={version:1;current:StorySnapshot;previous:StorySnapshot|null;candidate:Candidate|null;pending:PendingRequest|null;saved_at:string};
export function validateSnapshot(value:unknown):value is StorySnapshot{
  if(!value||typeof value!=="object")return false;
  const s=value as StorySnapshot;
  if(s.recognition!==null&&(!s.recognition||typeof s.recognition.summary!=="string"||!Array.isArray(s.recognition.character_clues)||!Array.isArray(s.recognition.questions)||!Array.isArray(s.recognition.hard_constraints)||!Array.isArray(s.recognition.ambiguities)))return false;
  if(!Array.isArray(s.timeline_suggestions)||!s.timeline_suggestions.every(isTimelineEvent))return false;
  return s.snapshot_version===1&&["western_fantasy","eastern_wuxia"].includes(s.preset_id)&&Number.isInteger(s.snapshot_revision)&&s.snapshot_revision>0&&typeof s.input==="string"&&Array.isArray(s.messages)&&s.messages.every(m=>m&&typeof m.id==="string"&&["user","assistant","system"].includes(m.role)&&typeof m.content==="string")&&Array.isArray(s.operations)&&s.operations.every(o=>o&&typeof o.operation_id==="string"&&typeof o.fingerprint==="string"&&Number.isInteger(o.revision))&&Array.isArray(s.timeline_suggestions)&&validatePair(s.world,s.characters).length===0&&s.world.revision===s.snapshot_revision&&s.characters.revision===s.snapshot_revision;
}
export function serializeWorkspace(workspace:SavedWorkspace):string{
  if(!validateSnapshot(workspace.current))throw new Error("当前故事不符合保存规范，请先处理字段或引用冲突。");
  return JSON.stringify(workspace);
}
export function deserializeWorkspace(text:string):SavedWorkspace{
  const data=JSON.parse(text) as SavedWorkspace;
  if(data.version!==1)throw new Error("保存版本不受支持，原记录已保留。");
  if(!validateSnapshot(data.current))throw new Error("本地故事校验未通过，原记录已保留，请勿覆盖。");
  if(data.previous!==null&&!validateSnapshot(data.previous))throw new Error("上一份快照损坏，原记录已保留。");
  if(data.candidate && (typeof data.candidate.operation_id!=="string"||validatePair(data.candidate.world,data.candidate.characters).length)) data.candidate=null;
  if(data.candidate?.base && (!data.candidate.base.world || !data.candidate.base.characters || typeof data.candidate.base.story_idea!=="string" || !Array.isArray(data.candidate.base.timeline_suggestions) || validatePair(data.candidate.base.world,data.candidate.base.characters).length))throw new Error("候选比对基线损坏，原记录已保留，不能自动覆盖。");
  if(data.pending && (!["framework","npcs","revise","field"].includes(data.pending.endpoint)||typeof data.pending.body?.operation_id!=="string"))data.pending=null;
  return data;
}
export function exportDocument(snapshot:StorySnapshot,kind:"world"|"characters"):string{
  const issues=validatePair(snapshot.world,snapshot.characters);
  if(issues.length)throw new Error("导出被阻止："+issues[0].message);
  return JSON.stringify(snapshot[kind],null,2);
}
