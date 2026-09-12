import { NextResponse } from "next/server";
import type { AgentEndpoint, StorySnapshot } from "@/lib/story/contracts";
import { createMainAgent } from "@/lib/orchestration/main-agent";
import { OrchestrationError, type TurnCommand } from "@/lib/orchestration/contracts";
import { assertSameOrigin } from "../_io";
import { agentRequest, errorResponse } from "../_handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { return NextResponse.json(await createMainAgent().status(new URL(request.url).searchParams.get("story_id") ?? "")); }
  catch (error) { return respond(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const text = await request.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new OrchestrationError("request_too_large", "请求超过 2 MB。", 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw new OrchestrationError("invalid_json", "请求必须是 JSON。", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new OrchestrationError("invalid_request", "请求必须是对象。", 400);
    const allowed: Record<string, string[]> = {
      initialize: ["action", "snapshot"], turn: ["action", "story_id", "operation_id", "base_revision", "input", "close_chapter", "retry_failed", "reply_to", "dialogue_action", "dialogue_id", "dialogue_revision"],
      framework: ["action", "request"], npcs: ["action", "request"], revise: ["action", "request"], field: ["action", "request"],
    };
    const action = typeof body.action === "string" ? body.action : "";
    if (!Object.hasOwn(allowed, action) || Object.keys(body).some(key => !allowed[action].includes(key))) throw new OrchestrationError("invalid_action", "操作或请求字段无效。", 400);
    const main = createMainAgent();
    if (action === "initialize") return NextResponse.json(await main.initialize(body.snapshot as StorySnapshot));
    if (action === "turn") return NextResponse.json(await main.turn(body as unknown as TurnCommand));
    const input = await agentRequest(new Request(request.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body.request) }));
    return NextResponse.json(await main.settings(action as AgentEndpoint, input));
  } catch (error) { return respond(error); }
}

function respond(error: unknown) {
  if (error instanceof OrchestrationError) return NextResponse.json({ error: { code: error.code, userMessage: error.message, retryable: false } }, { status: error.status });
  return errorResponse(error);
}
