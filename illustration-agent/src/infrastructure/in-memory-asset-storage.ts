import { createHash } from "node:crypto";

import { SystemClock, UuidGenerator } from "../application/system.js";
import type { AssetRecord, GeneratedImagePayload } from "../domain.js";
import type { AssetStorage, Clock, IdGenerator, PersistAssetInput } from "../ports.js";

function payloadBytes(payload: GeneratedImagePayload): Uint8Array {
  if (payload.bytes) return payload.bytes;
  if (payload.sourceUrl) return new TextEncoder().encode(payload.sourceUrl);
  throw new Error("生成结果既没有 bytes 也没有 sourceUrl");
}

export class InMemoryAssetStorage implements AssetStorage {
  private readonly payloads = new Map<string, GeneratedImagePayload>();

  constructor(
    private readonly ids: IdGenerator = new UuidGenerator(),
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async persist(input: PersistAssetInput): Promise<AssetRecord> {
    const assetId = this.ids.next("asset");
    const bytes = payloadBytes(input.payload);
    const extension = input.payload.mimeType === "image/svg+xml"
      ? "svg"
      : input.payload.mimeType === "image/png" ? "png" : "webp";
    const scope = input.purpose === "chapter_illustration"
      ? `chapters/${input.chapterNo}`
      : `characters/${input.characterId}`;
    const objectKey = `stories/${input.storyId}/${scope}/${input.logicalId}/v${input.version}.${extension}`;
    this.payloads.set(assetId, structuredClone(input.payload));
    const displayUrl = input.payload.bytes
      ? `data:${input.payload.mimeType};base64,${Buffer.from(input.payload.bytes).toString("base64")}`
      : input.payload.sourceUrl;
    return {
      assetId,
      permanentUri: `memory://${objectKey}`,
      objectKey,
      ...(displayUrl ? { displayUrl } : {}),
      mimeType: input.payload.mimeType,
      width: input.payload.width,
      height: input.payload.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: this.clock.now(),
    };
  }

  async getDisplayUrl(asset: AssetRecord): Promise<string> {
    if (!asset.displayUrl) throw new Error(`资源 ${asset.assetId} 没有可展示地址`);
    return asset.displayUrl;
  }
}
