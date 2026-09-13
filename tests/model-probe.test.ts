import { describe, expect, it } from "vitest";
import { loadEnvConfig } from "@next/env";
import { ChatCompletionsClient, parseModelJson, readModelConfig } from "@/lib/ai/model";

loadEnvConfig(process.cwd(), true);
const live = process.env.RUN_REAL_MODEL === "1";

/** Minimal paid probe per configured role. Skipped unless RUN_REAL_MODEL=1. */
describe.runIf(live)("real provider probe", () => {
  it("answers on every configured role", async () => {
    const results: Record<string, unknown>[] = [];
    for (const role of ["text", "fast"] as const) {
      const config = readModelConfig(process.env, role);
      try {
        const reply = await new ChatCompletionsClient(config, fetch, 512).complete("You are a text assistant. Answer briefly.", "请只回复 OK。");
        results.push({ kind: "text", role, model: config.model, http: reply.telemetry.httpStatus, sec: Math.round(reply.telemetry.durationMs / 100) / 10, content: reply.content.trim().slice(0, 30) });
      } catch (error) {
        results.push({ kind: "text", role, model: config.model, error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log("PROBE-TEXT " + JSON.stringify(results));
    expect(results.every(item => typeof item.content === "string" && (item.content as string).length > 0)).toBe(true);
  }, 240000);

  it("returns parseable structured JSON on every configured role", async () => {
    const results: Record<string, unknown>[] = [];
    for (const role of ["text", "fast"] as const) {
      const config = readModelConfig(process.env, role);
      try {
        const reply = await new ChatCompletionsClient(config, fetch, 900, true).complete("你是结构化生成服务，只输出 JSON。", "以东方武侠为题，输出 {\"title\": 中文标题, \"logline\": 一句话梗概, \"events\": 三条按时间排序的事件字符串}。不要解释。");
        let shape = "";
        try { const parsed = parseModelJson(reply.content) as Record<string, unknown>; shape = Array.isArray(parsed?.events) ? "events:" + (parsed.events as unknown[]).length + " title:" + String(parsed.title ?? "").slice(0, 12) : "missing-events"; }
        catch { shape = "unparsable:" + reply.content.trim().slice(0, 60); }
        results.push({ kind: "json", role, model: config.model, http: reply.telemetry.httpStatus, sec: Math.round(reply.telemetry.durationMs / 100) / 10, shape });
      } catch (error) {
        results.push({ kind: "json", role, model: config.model, error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log("PROBE-JSON " + JSON.stringify(results));
    expect(results.every(item => typeof item.shape === "string" && (item.shape as string).startsWith("events:"))).toBe(true);
  }, 300000);

  it("reports whether the fast model answers the same JSON request without response_format", async () => {
    const config = readModelConfig(process.env, "fast");
    const reply = await new ChatCompletionsClient(config, fetch, 900, false).complete("你是结构化生成服务，只输出 JSON。", "以东方武侠为题，输出 {\"title\": 中文标题, \"events\": 三条事件字符串}。不要解释。");
    const parsed = parseModelJson(reply.content) as { events?: unknown[]; title?: string };
    console.log("PROBE-JSON-NOFORMAT " + JSON.stringify({ model: config.model, http: reply.telemetry.httpStatus, sec: Math.round(reply.telemetry.durationMs / 100) / 10, events: parsed?.events?.length ?? 0, title: String(parsed?.title ?? "").slice(0, 12) }));
    expect(reply.content.length).toBeGreaterThan(0);
  }, 300000);
});