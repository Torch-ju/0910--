import type { StorySnapshot } from "@/lib/story/contracts";
/** Remove editor/audit metadata only. Never mutate the persisted source or its facts. */
export function creativeSnapshot(snapshot:StorySnapshot):unknown {
  const omit=new Set(["created_at","updated_at","change_log","revision","snapshot_revision","snapshot_version","messages"]);
  const visit=(value:unknown):unknown=>Array.isArray(value)?value.map(visit):value && typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!omit.has(key)).map(([key,child])=>[key,visit(child)])):value;
  const creative = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "operations"));
  return visit(creative);
}
