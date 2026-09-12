export type Project = { id: string; title: string; focus: string; revision: number; agent_revision: number; updated_at: string };
export type Message = { id: string; role: string; content: string; created_at: string };
export type Proposal = { id: string; title: string; content: string; rationale: string; status: string; kind: string; ordinal: number; message_id: string };
export type Artifact = { id: string; title: string; content: string; kind: string; version: number; active: boolean; source: string; created_at: string };
export type Run = { id: string; status: string; message_id: string; error: { code: string; message: string } | null };
export type Workspace = { project: Project; artifacts: Artifact[]; proposals: Proposal[]; latest_run: Run | null };
export type Health = { mode: string; model_configured: boolean; streaming: string };
export class ApiError extends Error { constructor(message: string, public code: string) { super(message); } }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.message || "连接失败，请稍后重试。", body.error?.code || "UNKNOWN");
  return body as T;
}
export const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
export const requestId = () => crypto.randomUUID();
export const kinds: Record<string, string> = { story_seed: "故事种子", character_note: "人物", world_note: "世界", project_brief: "创作设定", open_question: "待探索" };
