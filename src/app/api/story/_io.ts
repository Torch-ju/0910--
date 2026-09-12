import { NextResponse } from "next/server";
import { z } from "zod";
import { OrchestrationError } from "@/lib/orchestration/contracts";
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const url = new URL(request.url);
  // Next may construct request.url with its internal hostname (localhost),
  // while the browser requested 127.0.0.1. Host retains the requested authority.
  // Do not trust forwarded-host headers without an explicitly trusted proxy.
  const host = request.headers.get("host") ?? url.host;
  let expectedOrigin: string;
  try {
    const target = new URL(`${url.protocol}//${host}`);
    if (target.host !== host || target.username || target.password) throw Error();
    expectedOrigin = target.origin;
  } catch {
    throw new OrchestrationError("origin_rejected", "请求的网站地址无效。", 403);
  }
  if (origin !== expectedOrigin) throw new OrchestrationError("origin_rejected", "不接受其他网站发起的写入请求。", 403);
}
export async function safeBody(request: Request) {
  assertSameOrigin(request);
  const reader = request.body?.getReader();
  if (!reader) throw new OrchestrationError("invalid_request", "缺少请求内容。", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 20_000_000) { await reader.cancel(); throw new OrchestrationError("request_too_large", "请求不能超过 20 MB。", 413); }
    chunks.push(value);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body;
  } catch { throw new OrchestrationError("invalid_json", "请求须为 JSON 对象。", 400); }
}
export function respond(error: unknown) {
  if (error instanceof OrchestrationError) return NextResponse.json({ error: { code: error.code, userMessage: error.message } }, { status: error.status });
  if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "invalid_request", userMessage: "字段校验失败：" + error.issues.map(i => i.path.join(".") + " " + i.message).join("；") } }, { status: 400 });
  return NextResponse.json({ error: { code: "operation_failed", userMessage: "操作未完成，现有数据保留。" } }, { status: 500 });
}
