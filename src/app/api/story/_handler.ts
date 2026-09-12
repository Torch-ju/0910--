import { assertSameOrigin } from "./_io";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { AgentRequest, AppError } from "@/lib/story/contracts";
import { validateCharacters, validateWorld } from "@/lib/story/validation";
import { isStableOperationId, StoryProviderError } from "@/lib/ai/model";

const statusFor = (code: string): number => ({ invalid_request: 400, idempotency_conflict: 409, operation_unavailable: 409, schema_error: 422, request_budget_exhausted: 429, request_timeout: 504, configuration_error: 503, ledger_error: 503 }[code] ?? 502);
const generic: AppError = { code: "internal_error", userMessage: "服务端处理请求时发生错误。", retryable: false };

export function errorResponse(error: unknown): NextResponse<{ error: AppError }> {
  if (error instanceof OrchestrationError) return NextResponse.json({ error: { code: error.code, userMessage: error.message, retryable: false } }, { status: error.status });
  const base = error instanceof StoryProviderError ? error.error : generic;
  const withTrace: AppError = { ...base, requestId: base.requestId ?? randomUUID(), fieldErrors: base.fieldErrors ?? [{ code: base.code, path: "/", message: base.userMessage }] };
  return NextResponse.json({ error: withTrace }, { status: error instanceof StoryProviderError ? error.status || statusFor(base.code) : 500 });
}

const invalid = (message: string): never => { throw new StoryProviderError({ code: "invalid_request", userMessage: message, retryable: false }, 400); };
export async function agentRequest(request: Request): Promise<AgentRequest> {
  assertSameOrigin(request);
  let body: unknown;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 512 * 1024) invalid("请求体超过允许大小。");
  try {
    const raw = await request.text();
    if (raw.length > 512 * 1024) invalid("请求体超过允许大小。");
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof StoryProviderError) throw error;
    invalid("请求必须是 JSON 对象。");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("请求必须是 AgentRequest 对象。");
  const candidate = body as Partial<AgentRequest>;
  const baseRevision = candidate.base_revision;
  if (Object.keys(candidate).some((key) => key === "__proto__" || key === "prototype" || key === "constructor")) invalid("请求包含不允许的原型字段。");
  if (typeof candidate.operation_id !== "string" || !isStableOperationId(candidate.operation_id) || typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0 || baseRevision > 2_147_483_647 || (candidate.preset_id !== "western_fantasy" && candidate.preset_id !== "eastern_wuxia") || typeof candidate.input !== "string" || !candidate.input.trim() || candidate.input.length > 24_000 || !candidate.world || !candidate.characters || !(candidate.recognition === null || typeof candidate.recognition === "object")) invalid("AgentRequest 缺少必需字段或字段无效。");
  if (candidate.target !== undefined && candidate.target !== "world" && candidate.target !== "timeline" && candidate.target !== "npc") invalid("target 必须是 world、timeline 或 npc。");
  if (candidate.character_id !== undefined && typeof candidate.character_id !== "string") invalid("character_id 必须是字符串。");
  if (candidate.context !== undefined && (!candidate.context || typeof candidate.context !== "object" || typeof candidate.context.story_idea !== "string" || candidate.context.story_idea.length > 24_000 || !Array.isArray(candidate.context.user_notes) || candidate.context.user_notes.length > 100 || !candidate.context.user_notes.every((note) => typeof note === "string" && note.length <= 8_000))) invalid("context 必须包含受限长度的 story_idea 和 user_notes。");
  if (candidate.field !== undefined && (!candidate.field || typeof candidate.field !== "object" || (candidate.field.document !== "world" && candidate.field.document !== "characters") || typeof candidate.field.path !== "string" || !candidate.field.path.startsWith("/") || candidate.field.path.length > 1_000)) invalid("field 必须包含合法 document 和 JSON Pointer path。");
  const worldIssues = validateWorld(candidate.world);
  const characterIssues = validateCharacters(candidate.characters);
  if (worldIssues.length || characterIssues.length) throw new StoryProviderError({ code: "invalid_request", userMessage: "提交的故事状态未通过数据契约校验。", retryable: false, fieldErrors: [...worldIssues, ...characterIssues] }, 400);
  return candidate as AgentRequest;
}
import { OrchestrationError } from "@/lib/orchestration/contracts";
