import type { Pool } from "pg";

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingIndexResult {
  indexed: number;
  remaining: number;
}

/**
 * A background worker. The transaction that writes narrative memory never waits
 * for an external embedding provider, so provider failures cannot roll back facts.
 */
export class PostgresEmbeddingIndexer {
  constructor(
    private readonly pool: Pool,
    private readonly provider: EmbeddingProvider,
    private readonly databaseDimensions = 1536,
  ) {
    if (provider.dimensions !== databaseDimensions) {
      throw new Error(
        `Embedding dimension mismatch: provider=${provider.dimensions}, database=${databaseDimensions}`,
      );
    }
  }

  async indexPending(batchSize = 32): Promise<EmbeddingIndexResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pending = await client.query(
        `SELECT embedding_id, content_text
         FROM memory_embeddings
         WHERE embedding IS NULL
         ORDER BY embedding_id
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (pending.rows.length === 0) {
        await client.query("COMMIT");
        return { indexed: 0, remaining: 0 };
      }

      const vectors = await this.provider.embed(
        pending.rows.map((row) => row.content_text as string),
      );
      if (vectors.length !== pending.rows.length) {
        throw new Error("Embedding provider returned a different number of vectors");
      }
      for (let index = 0; index < pending.rows.length; index += 1) {
        const row = pending.rows[index];
        const vector = vectors[index];
        if (!row || !vector || vector.length !== this.databaseDimensions) {
          throw new Error(`Invalid embedding at batch index ${index}`);
        }
        await client.query(
          "UPDATE memory_embeddings SET embedding=$2::vector WHERE embedding_id=$1",
          [row.embedding_id, `[${vector.join(",")}]`],
        );
      }
      const remainingResult = await client.query(
        "SELECT count(*)::int AS count FROM memory_embeddings WHERE embedding IS NULL",
      );
      await client.query("COMMIT");
      return {
        indexed: pending.rows.length,
        remaining: Number(remainingResult.rows[0]?.count ?? 0),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly dimensions: number,
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs?: number;
    },
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 60_000);
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: this.options.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ index: number; embedding: number[] }>;
      };
      const rows = [...(payload.data ?? [])].sort((left, right) => left.index - right.index);
      return rows.map((row) => row.embedding);
    } finally {
      clearTimeout(timeout);
    }
  }
}
