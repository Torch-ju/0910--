import type { GeneratedImagePayload, GenerationRequest } from "../domain.js";
import type { ImageGenerator } from "../ports.js";

interface SeedreamResponseItem {
  url?: string;
  b64_json?: string;
  size?: string;
}

interface SeedreamResponse {
  data?: SeedreamResponseItem[];
  request_id?: string;
  id?: string;
  error?: { message?: string };
}

export interface Seedream45Config {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  responseFormat?: "url" | "b64_json";
}

export class Seedream45ImageGenerator implements ImageGenerator {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly responseFormat: "url" | "b64_json";

  constructor(private readonly config: Seedream45Config) {
    if (!config.apiKey.trim()) throw new Error("Seedream API Key 不能为空");
    this.model = config.model ?? "doubao-seedream-4.5";
    this.baseUrl = (config.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 1_200_000;
    this.responseFormat = config.responseFormat ?? "url";
  }

  async generate(request: GenerationRequest): Promise<GeneratedImagePayload> {
    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        prompt: `${request.prompt}\n避免出现：${request.negativePrompt}`,
        ...(request.referenceImageUrls.length === 1 ? { image: request.referenceImageUrls[0] } : {}),
        ...(request.referenceImageUrls.length > 1 ? { image: request.referenceImageUrls } : {}),
        size: `${request.width}x${request.height}`,
        sequential_image_generation: "disabled",
        stream: false,
        response_format: this.responseFormat,
        watermark: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await response.text();
    let body: SeedreamResponse;
    try {
      body = JSON.parse(raw) as SeedreamResponse;
    } catch {
      throw new Error(`Seedream 返回了非 JSON 响应（HTTP ${response.status}）`);
    }
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Seedream 请求失败（HTTP ${response.status}）`);
    }
    const first = body.data?.[0];
    if (!first) throw new Error("Seedream 没有返回图片");
    const common = {
      mimeType: "image/png",
      width: request.width,
      height: request.height,
      ...(body.request_id || body.id ? { providerRequestId: body.request_id ?? body.id } : {}),
    };
    if (first.url) return { ...common, sourceUrl: first.url };
    if (first.b64_json) {
      return { ...common, bytes: Uint8Array.from(Buffer.from(first.b64_json, "base64")) };
    }
    throw new Error("Seedream 响应缺少 url 或 b64_json");
  }
}
