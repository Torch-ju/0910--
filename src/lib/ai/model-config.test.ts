import { describe, expect, it } from "vitest";
import { ChatCompletionsClient, providerStatus, readModelConfig } from "@/lib/ai/model";

const base = { LLM_BASE_URL: "https://example.invalid/v1", LLM_MODEL: "main-model", LLM_API_KEY: "x".repeat(20) };

describe("fast model role", () => {
  it("routes the fast role to LLM_MODEL_FAST when it is configured", () => {
    const env = { ...base, LLM_MODEL_FAST: "deepseek-v4-flash-vision-exp" };
    expect(readModelConfig(env, "text").model).toBe("main-model");
    expect(readModelConfig(env, "fast").model).toBe("deepseek-v4-flash-vision-exp");
  });

  it("falls back to the drafting model when LLM_MODEL_FAST is empty", () => {
    expect(readModelConfig({ ...base, LLM_MODEL_FAST: "   " }, "fast").model).toBe("main-model");
    expect(readModelConfig(base, "fast").model).toBe("main-model");
  });

  it("keeps the status endpoint on the drafting model", () => {
    const status = providerStatus({ ...base, LLM_MODEL_FAST: "flash-model" }, 3);
    expect(status.configured).toBe(true);
    expect(status.model).toBe("main-model");
    expect(status.used).toBe(3);
  });
});
describe("response_format capability", () => {
  it("omits response_format for the listed models and keeps it for the rest", async () => {
    const bodies: string[] = [];
    const fetcher = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    process.env.LLM_NO_RESPONSE_FORMAT_MODELS = "flash-model";
    try {
      await new ChatCompletionsClient(readModelConfig({ ...base, LLM_MODEL_FAST: "flash-model" }, "fast"), fetcher, 32, true).complete("s", "u");
      await new ChatCompletionsClient(readModelConfig({ ...base, LLM_MODEL_FAST: "other-model" }, "fast"), fetcher, 32, true).complete("s", "u");
    } finally { delete process.env.LLM_NO_RESPONSE_FORMAT_MODELS; }
    expect(bodies[0]).not.toContain("response_format");
    expect(bodies[0]).toContain("flash-model");
    expect(bodies[1]).toContain("response_format");
  });
});