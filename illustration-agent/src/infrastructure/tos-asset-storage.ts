import { createHash } from "node:crypto";

import { SystemClock, UuidGenerator } from "../application/system.js";
import type { AssetRecord, GeneratedImagePayload } from "../domain.js";
import type { AssetStorage, Clock, IdGenerator, PersistAssetInput } from "../ports.js";

export interface TosAssetStorageConfig {
  bucket: string;
  publicBaseUrl?: string;
  signedUrlExpiresSeconds?: number;
}

export interface TosObjectClient {
  putObject(input: {
    bucket?: string;
    key: string;
    body?: Buffer;
    contentType?: string;
    forbidOverwrite?: boolean;
    meta?: Record<string, string>;
  }): Promise<unknown>;
  getPreSignedUrl(input: {
    bucket?: string;
    key: string;
    method?: "GET" | "PUT";
    expires?: number;
  }): string;
}

async function downloadPayload(payload: GeneratedImagePayload): Promise<Buffer> {
  if (payload.bytes) return Buffer.from(payload.bytes);
  if (!payload.sourceUrl) throw new Error("生成结果既没有 bytes 也没有 sourceUrl");
  const response = await fetch(payload.sourceUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`下载 Seedream 临时图片失败（HTTP ${response.status}）`);
  return Buffer.from(await response.arrayBuffer());
}

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  return "webp";
}

export class TosAssetStorage implements AssetStorage {
  private readonly publicBaseUrl: string | undefined;
  private readonly signedUrlExpiresSeconds: number;

  constructor(
    private readonly client: TosObjectClient,
    private readonly config: TosAssetStorageConfig,
    private readonly ids: IdGenerator = new UuidGenerator(),
    private readonly clock: Clock = new SystemClock(),
  ) {
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/$/, "");
    this.signedUrlExpiresSeconds = config.signedUrlExpiresSeconds ?? 3600;
  }

  async persist(input: PersistAssetInput): Promise<AssetRecord> {
    const body = await downloadPayload(input.payload);
    const extension = extensionFor(input.payload.mimeType);
    const scope = input.purpose === "chapter_illustration"
      ? `chapters/${input.chapterNo}/illustrations`
      : `characters/${input.characterId}/references`;
    const objectKey = `stories/${input.storyId}/${scope}/${input.logicalId}/v${input.version}.${extension}`;
    await this.client.putObject({
      bucket: this.config.bucket,
      key: objectKey,
      body,
      contentType: input.payload.mimeType,
      forbidOverwrite: true,
      meta: {
        "story-id": input.storyId,
        purpose: input.purpose,
      },
    });
    const displayUrl = this.publicBaseUrl ? `${this.publicBaseUrl}/${objectKey}` : undefined;
    return {
      assetId: this.ids.next("asset"),
      permanentUri: `tos://${this.config.bucket}/${objectKey}`,
      objectKey,
      ...(displayUrl ? { displayUrl } : {}),
      mimeType: input.payload.mimeType,
      width: input.payload.width,
      height: input.payload.height,
      sha256: createHash("sha256").update(body).digest("hex"),
      createdAt: this.clock.now(),
    };
  }

  async getDisplayUrl(asset: AssetRecord): Promise<string> {
    if (this.publicBaseUrl) return `${this.publicBaseUrl}/${asset.objectKey}`;
    return this.client.getPreSignedUrl({
      bucket: this.config.bucket,
      key: asset.objectKey,
      method: "GET",
      expires: this.signedUrlExpiresSeconds,
    });
  }
}
