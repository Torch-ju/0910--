import { readCompletion, StreamProgressError } from "./completion-stream";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AppError, ProviderStatus } from "@/lib/story/contracts";

export const EFFECTIVE_REQUEST_LIMIT = Number.MAX_SAFE_INTEGER;
export const DEFAULT_OUTPUT_TOKENS = 8192;
export const DEFAULT_TIMEOUT_MS = 180_000;

export type ModelConfig = { baseUrl: string; model: string; apiKey: string; timeoutMs?: number };
export type AttemptTelemetry = { startedAt: string; endedAt: string; model: string; httpStatus?: number; durationMs: number; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
export type ModelReply = { content: string; finishReason: string | null; telemetry: AttemptTelemetry };
type StoredFailure = { code: string; userMessage: string; retryable: boolean };
type Receipt = {
  fingerprint: string;
  state: "in_progress" | "success" | "failed" | "uncertain";
  attempts: ({ id: string; kind: "initial" | "repair"; state: string } & Partial<AttemptTelemetry>)[];
  result?: unknown;
  validationFailures?: { issues: unknown; output: string; at: string }[];
  failure?: StoredFailure;
};
type Ledger = { version: 1; used: number; receipts: Record<string, Receipt> };
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class StoryProviderError extends Error {
  constructor(public readonly error: AppError, public readonly status: number, public readonly telemetry?: AttemptTelemetry) {
    super(error.userMessage);
  }
}

const appError = (code: string, userMessage: string, retryable = false): AppError => ({ code, userMessage, retryable });
const fail = (code: string, message: string, status: number, retryable = false): never => {
  throw new StoryProviderError(appError(code, message, retryable), status);
};

const isLocalHttp = (url: URL) => url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const imageOnlyModel = (model: string) => /seedream|seedance|(?:^|[-_])image(?:[-_]|$)|(?:^|[-_])video(?:[-_]|$)|sora|wanx|flux|midjourney/i.test(model);
// Some routed models answer with an empty message when response_format is sent; list those explicitly instead of guessing.
const skipsResponseFormat = (model: string, env: Record<string, string | undefined> = process.env) => (env.LLM_NO_RESPONSE_FORMAT_MODELS ?? "").split(",").map(value => value.trim()).filter(Boolean).includes(model);
export const isStableOperationId = (value: string) => /^[a-z][a-z0-9_-]{2,95}$/.test(value) && !["__proto__", "prototype", "constructor"].includes(value);

export function readModelConfig(env: Record<string, string | undefined> = process.env, role: "text" | "fast" = "text"): ModelConfig {
  const base = env.LLM_BASE_URL?.trim();
  // Interactive steps (setup agents and role dialogue) may run on a faster model; long prose keeps the main one.
  const fastModel = env.LLM_MODEL_FAST?.trim();
  const model = role === "fast" && fastModel ? fastModel : env.LLM_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  if (!base || !model || !apiKey) return fail("configuration_error", "服务端文字模型尚未配置。", 503);
  const configuredBase: string = base;
  const configuredModel: string = model;
  const configuredKey: string = apiKey;
  if (imageOnlyModel(configuredModel)) return fail("configuration_error", "当前配置的是图像或视频模型，请改用文字对话模型。", 503);
  let url: URL;
  try { url = new URL(configuredBase); } catch { return fail("configuration_error", "模型服务地址无效。", 503); }
  if (url.protocol !== "https:" && !isLocalHttp(url)) return fail("configuration_error", "模型服务地址必须使用 HTTPS。", 503);
  const timeoutValue = env.LLM_TIMEOUT_MS === undefined ? DEFAULT_TIMEOUT_MS : Number(env.LLM_TIMEOUT_MS);
  if (!Number.isInteger(timeoutValue) || timeoutValue < 1_000 || timeoutValue > 300_000) return fail("configuration_error", "LLM_TIMEOUT_MS 必须为 1000 至 300000 毫秒。", 503);
  const normalized = url.pathname.replace(/\/+$/, "");
  url.pathname = normalized.endsWith("/v1") ? `${normalized}/chat/completions` : `${normalized}/v1/chat/completions`;
  return { baseUrl: url.toString(), model: configuredModel, apiKey: configuredKey, timeoutMs: timeoutValue };
}

export function providerStatus(env: Record<string, string | undefined> = process.env, used = 0): ProviderStatus {
  try {
    const config = readModelConfig(env);
    return { configured: true, model: config.model, used, limit: EFFECTIVE_REQUEST_LIMIT, remaining: EFFECTIVE_REQUEST_LIMIT - used };
  } catch (error) {
    const provider = error as StoryProviderError;
    return { configured: false, model: env.LLM_MODEL?.trim() || null, used, limit: EFFECTIVE_REQUEST_LIMIT, remaining: EFFECTIVE_REQUEST_LIMIT - used, configuration_error: provider.error?.userMessage ?? "模型配置不可用。" };
  }
}

async function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const scope = globalThis as typeof globalThis & { __shuzhongrenLedgerMutex?: Promise<void> };
  const previous = scope.__shuzhongrenLedgerMutex ?? Promise.resolve();
  let release!: () => void;
  scope.__shuzhongrenLedgerMutex = new Promise<void>((resolvePromise) => { release = resolvePromise; });
  await previous;
  try { return await work(); } finally { release(); }
}

export class RequestLedger {
  constructor(readonly path = process.env.MODEL_LEDGER_PATH ?? resolve(process.cwd(), "runtime", "model-requests.json")) {}
  private async load(): Promise<Ledger> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as Ledger;
      if (value.version !== 1 || !Number.isInteger(value.used) || !value.receipts || typeof value.receipts !== "object") throw new Error("invalid");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, used: 0, receipts: Object.create(null) as Record<string, Receipt> };
      return fail("ledger_error", "请求账本不可读取，已停止调用以避免重复计费。", 503);
    }
  }
  private async save(value: Ledger): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, this.path);
  }
  async hasCompleted(operationId: string): Promise<boolean> {
    return exclusively(async () => { const receipts = (await this.load()).receipts; return [operationId, automaticOperationId(operationId,1), automaticOperationId(operationId,2)].some(id => receipts[id]?.state === "success"); });
  }
  async revalidate<T>(operationId:string, fingerprint:string, decode:(value:unknown)=>T):Promise<{replay?:T}> {
    return exclusively(async()=>{
      const ledger=await this.load(), receipt=ledger.receipts[operationId];
      if(!receipt || receipt.fingerprint!==fingerprint || receipt.state!=="failed" || receipt.failure?.code!=="schema_error")return {};
      const raw=receipt.validationFailures?.at(-1)?.output;if(!raw)return {};
      let result:T;try {result=decode(parseModelJson(raw));}catch{return {};}
      receipt.state="success";receipt.result=result;
      // Preserve original failed attempts and validation evidence for audit.
      await this.save(ledger);return {replay:result};
    });
  }
  async recordValidation(operationId: string, issues: unknown, output: string) {
    await exclusively(async () => {
      const ledger = await this.load();
      const receipt = ledger.receipts[operationId];
      if (receipt) { (receipt.validationFailures ??= []).push({ issues, output, at: new Date().toISOString() }); await this.save(ledger); }
    });
  }
  async statistics() {
    return exclusively(async () => {
      const ledger = await this.load(); const receipts = Object.values(ledger.receipts), attempts = receipts.flatMap(r => r.attempts);
      const promptTokens = attempts.reduce((sum, a) => sum + (a.usage?.promptTokens ?? 0), 0), completionTokens = attempts.reduce((sum, a) => sum + (a.usage?.completionTokens ?? 0), 0);
      const inputRate = Number(process.env.LLM_INPUT_PRICE_PER_MILLION), outputRate = Number(process.env.LLM_OUTPUT_PRICE_PER_MILLION);
      return { calls: ledger.used, repairs: attempts.filter(a => a.kind === "repair").length, failures: receipts.filter(r => r.state === "failed" || r.state === "uncertain").length, durationMs: attempts.reduce((sum, a) => sum + (a.durationMs ?? 0), 0), promptTokens, completionTokens, usageMissing: attempts.filter(a => !a.usage?.totalTokens).length, estimatedCost: Number.isFinite(inputRate) && inputRate >= 0 && Number.isFinite(outputRate) && outputRate >= 0 ? (promptTokens * inputRate + completionTokens * outputRate) / 1_000_000 : null };
    });
  }
  async used(): Promise<number> { return exclusively(async () => (await this.load()).used); }
  async reserve(operationId: string, fingerprint: string, model: string, kind: "initial" | "repair" = "initial"): Promise<{ replay?: unknown }> {
    return exclusively(async () => {
      if (!isStableOperationId(operationId)) fail("invalid_request", "operation_id 格式无效。", 400);
      const ledger = await this.load();
      const hasReceipt = Object.prototype.hasOwnProperty.call(ledger.receipts, operationId);
      const existing = hasReceipt ? ledger.receipts[operationId] : undefined;
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) fail("idempotency_conflict", "该操作 ID 已用于不同请求。", 409);
        if (existing.state === "success") return { replay: existing.result };
        if (kind === "initial" || existing.state === "uncertain") {
          fail("operation_unavailable", "该操作已有未完成或不可确定的请求，不能自动重试。", 409);
        }
        if (existing.state === "failed") fail(existing.failure?.code ?? "provider_error", existing.failure?.userMessage ?? "先前请求失败。", 502, existing.failure?.retryable);
      }
      const max = process.env.LLM_MAX_REQUESTS === undefined ? null : Number(process.env.LLM_MAX_REQUESTS);
      if (max !== null && (!Number.isInteger(max) || max < 1)) fail("budget_configuration", "LLM_MAX_REQUESTS 必须为正整数或不配置。", 503);
      if (max !== null && ledger.used >= max) fail("configured_budget_exhausted", "已达到配置的模型调用预算，请调整配置后恢复。", 429);
      ledger.used += 1;
      const receipt = existing ?? { fingerprint, state: "in_progress" as const, attempts: [] };
      receipt.state = "in_progress";
      receipt.attempts.push({ id: randomUUID(), kind, state: "reserved", startedAt: new Date().toISOString(), model });
      ledger.receipts[operationId] = receipt;
      await this.save(ledger);
      return {};
    });
  }
  async settleAttempt(operationId: string, telemetry: AttemptTelemetry): Promise<void> {
    await exclusively(async () => {
      const ledger = await this.load();
      if (!Object.prototype.hasOwnProperty.call(ledger.receipts, operationId)) return;
      const attempt = ledger.receipts[operationId].attempts.at(-1);
      if (!attempt) return;
      attempt.state = "completed";
      attempt.endedAt = telemetry.endedAt;
      attempt.httpStatus = telemetry.httpStatus;
      attempt.durationMs = telemetry.durationMs;
      attempt.usage = telemetry.usage;
      await this.save(ledger);
    });
  }
  async finish(operationId: string, state: "success" | "failed" | "uncertain", result?: unknown, failure?: StoredFailure): Promise<void> {
    await exclusively(async () => {
      const ledger = await this.load();
      if (!Object.prototype.hasOwnProperty.call(ledger.receipts, operationId)) return;
      const receipt = ledger.receipts[operationId];
      receipt.state = state;
      const last = receipt.attempts.at(-1);
      if (last) last.state = state;
      if (state === "success") receipt.result = result;
      if (failure) receipt.failure = failure;
      await this.save(ledger);
    });
  }
}

export const fingerprintFor = (action: string, input: unknown, baseRevision: number) =>
  createHash("sha256").update(JSON.stringify({ action, input, baseRevision })).digest("hex");

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try { return JSON.parse(candidate); } catch { return fail("schema_error", "模型没有返回可解析的 JSON。", 422); }
}

export class ChatCompletionsClient {
  constructor(private readonly config: ModelConfig, private readonly fetcher: FetchLike = fetch, private readonly maxTokens: number | null = DEFAULT_OUTPUT_TOKENS, private readonly jsonMode = false) {}
  async complete(system: string, user: string, progress?: (text:string)=>Promise<void>): Promise<ModelReply> {
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const telemetry = (httpStatus?: number, usage?: AttemptTelemetry["usage"]): AttemptTelemetry => ({ startedAt, endedAt: new Date().toISOString(), model: this.config.model, httpStatus, durationMs: Date.now() - startedMs, usage });
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetcher(this.config.baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.4, ...(this.jsonMode && !skipsResponseFormat(this.config.model) ? {response_format:{type:"json_object"}} : {}), ...(progress && process.env.LLM_STREAM !== "false" ? {stream:true} : {}), ...(this.maxTokens === null ? {} : { max_tokens: this.maxTokens }) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new StoryProviderError(appError("provider_error", "模型服务暂时不可用。", response.status >= 500), response.status === 429 ? 429 : 502, telemetry(response.status));
      const payload = await readCompletion(response,progress);
      const choice = payload.choices?.[0];
      if (!choice?.message?.content) throw new StoryProviderError(appError("provider_error", "模型服务未返回文本内容。"), 502, telemetry(response.status));
      const content: string = choice.message.content;
      if (choice.finish_reason === "length" || choice.finish_reason === "content_filter") throw new StoryProviderError(appError("incomplete_output", "模型输出不完整或被安全过滤。"), 422, telemetry(response.status));
      const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
      const usage = { promptTokens: count(payload.usage?.prompt_tokens), completionTokens: count(payload.usage?.completion_tokens), totalTokens: count(payload.usage?.total_tokens) };
      return { content, finishReason: choice.finish_reason ?? null, telemetry: telemetry(response.status, usage) };
    } catch (error) {
      if (error instanceof StreamProgressError) throw new StoryProviderError(appError("preview_save_failed", error.message), 503, telemetry());
      if (error instanceof StoryProviderError) throw error;
      if ((error as Error).name === "AbortError") throw new StoryProviderError(appError("request_timeout", `AI 服务 ${Math.ceil(timeoutMs / 1000)} 秒内没有响应，这次结果的去向未知。`, true), 504, telemetry());
      throw new StoryProviderError(appError("provider_error", "AI 服务调用失败，这次结果的去向未知。", true), 502, telemetry());
    } finally { clearTimeout(timeout); }
  }
}

export const automaticOperationId = (id: string, retry: number) => "op_" + createHash("sha256").update(`${id}:automatic-retry:${retry}`).digest("hex").slice(0,48);
