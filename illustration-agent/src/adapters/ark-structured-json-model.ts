import type { JsonModelRequest, StructuredJsonModel } from "../ports.js";

interface ArkChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export interface ArkStructuredJsonConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class ArkStructuredJsonModel implements StructuredJsonModel {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ArkStructuredJsonConfig) {
    if (!config.apiKey.trim()) throw new Error("Ark API Key 不能为空");
    if (!config.model.trim()) throw new Error("Ark 模型 ID 不能为空");
    this.baseUrl = (config.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async completeJson(request: JsonModelRequest): Promise<unknown> {
    const userContent = request.imageUrls?.length
      ? [
          { type: "text", text: request.userPrompt },
          ...request.imageUrls.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl } })),
        ]
      : request.userPrompt;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const raw = await response.text();
    let body: ArkChatResponse;
    try {
      body = JSON.parse(raw) as ArkChatResponse;
    } catch {
      throw new Error(`Ark 返回了非 JSON 响应（HTTP ${response.status}）`);
    }
    if (!response.ok) throw new Error(body.error?.message ?? `Ark 请求失败（HTTP ${response.status}）`);
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("Ark 响应缺少 message.content");
    try {
      return JSON.parse(content) as unknown;
    } catch {
      throw new Error("Ark 模型没有返回合法 JSON");
    }
  }
}
