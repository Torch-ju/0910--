import type { GeneratedImagePayload, GenerationRequest } from "../domain.js";
import type { ImageGenerator } from "../ports.js";

export class MockSeedreamImageGenerator implements ImageGenerator {
  readonly model = "doubao-seedream-4.5";
  readonly requests: GenerationRequest[] = [];
  private callCount = 0;

  constructor(private readonly failFirst = 0) {}

  async generate(request: GenerationRequest): Promise<GeneratedImagePayload> {
    this.requests.push(structuredClone(request));
    this.callCount += 1;
    if (this.callCount <= this.failFirst) throw new Error(`模拟 Seedream 失败 ${this.callCount}`);
    const title = request.chapterNo === 0 ? "人物标准参考图" : `第 ${request.chapterNo} 章插图`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${request.width}" height="${request.height}" viewBox="0 0 ${request.width} ${request.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#172033"/><stop offset="1" stop-color="#8b5e3c"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="50%" cy="42%" r="16%" fill="#d9b68c" opacity=".78"/><path d="M700 1240 Q1280 500 1860 1240" fill="#26364f"/><text x="50%" y="84%" text-anchor="middle" fill="#f7e7ce" font-size="94" font-family="sans-serif">${title}</text><text x="50%" y="91%" text-anchor="middle" fill="#d5c4aa" font-size="42" font-family="sans-serif">Seedream 4.5 验证占位图</text></svg>`;
    return {
      bytes: new TextEncoder().encode(svg),
      mimeType: "image/svg+xml",
      width: request.width,
      height: request.height,
      providerRequestId: `mock_${this.callCount}`,
    };
  }
}
