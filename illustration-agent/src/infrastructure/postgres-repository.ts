import { Pool, type PoolClient } from "pg";

import type {
  CharacterVisualProfile,
  GenerationAttempt,
  IllustrationVersion,
  ProcessedIllustrationRequest,
  ReferenceCandidate,
  StoryVisualBible,
} from "../domain.js";
import type { IllustrationRepository } from "../ports.js";

type JsonRow = { payload: unknown };

export class PostgresIllustrationRepository implements IllustrationRepository {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresIllustrationRepository {
    return new PostgresIllustrationRepository(new Pool({ connectionString }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getVisualBible(storyId: string): Promise<StoryVisualBible | undefined> {
    const result = await this.pool.query<JsonRow>(
      "SELECT payload FROM story_visual_bibles WHERE story_id = $1",
      [storyId],
    );
    return result.rows[0]?.payload as StoryVisualBible | undefined;
  }

  async saveVisualBible(bible: StoryVisualBible): Promise<void> {
    await this.pool.query(
      `INSERT INTO story_visual_bibles (story_id, version, status, payload, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (story_id) DO UPDATE SET
         version = EXCLUDED.version,
         status = EXCLUDED.status,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [bible.storyId, bible.version, bible.status, JSON.stringify(bible), bible.updatedAt],
    );
  }

  async getCharacterVisualProfile(storyId: string, characterId: string): Promise<CharacterVisualProfile | undefined> {
    const result = await this.pool.query<JsonRow>(
      "SELECT payload FROM character_visual_profiles WHERE story_id = $1 AND character_id = $2",
      [storyId, characterId],
    );
    return result.rows[0]?.payload as CharacterVisualProfile | undefined;
  }

  async listCharacterVisualProfiles(storyId: string): Promise<CharacterVisualProfile[]> {
    const result = await this.pool.query<JsonRow>(
      "SELECT payload FROM character_visual_profiles WHERE story_id = $1 ORDER BY display_name",
      [storyId],
    );
    return result.rows.map((row) => row.payload as CharacterVisualProfile);
  }

  async saveCharacterVisualProfile(profile: CharacterVisualProfile): Promise<void> {
    await this.pool.query(
      `INSERT INTO character_visual_profiles
         (story_id, character_id, display_name, role, version, status, payload, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (story_id, character_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         version = EXCLUDED.version,
         status = EXCLUDED.status,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [
        profile.storyId,
        profile.characterId,
        profile.displayName,
        profile.role,
        profile.version,
        profile.status,
        JSON.stringify(profile),
        profile.updatedAt,
      ],
    );
  }

  async saveReferenceCandidate(candidate: ReferenceCandidate): Promise<void> {
    await this.pool.query(
      `INSERT INTO character_reference_candidates
         (candidate_id, story_id, character_id, visual_profile_version, candidate_no, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (candidate_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
      [
        candidate.candidateId,
        candidate.storyId,
        candidate.characterId,
        candidate.visualProfileVersion,
        candidate.candidateNo,
        candidate.status,
        JSON.stringify(candidate),
        candidate.createdAt,
      ],
    );
  }

  async listReferenceCandidates(storyId: string, characterId: string): Promise<ReferenceCandidate[]> {
    const result = await this.pool.query<JsonRow>(
      `SELECT payload FROM character_reference_candidates
       WHERE story_id = $1 AND character_id = $2
       ORDER BY visual_profile_version DESC, candidate_no`,
      [storyId, characterId],
    );
    return result.rows.map((row) => row.payload as ReferenceCandidate);
  }

  async saveGenerationAttempt(attempt: GenerationAttempt): Promise<void> {
    await this.pool.query(
      `INSERT INTO illustration_generation_attempts
         (attempt_id, story_id, chapter_no, request_id, attempt_no, status, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (attempt_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
      [
        attempt.attemptId,
        attempt.storyId,
        attempt.chapterNo,
        attempt.requestId,
        attempt.attemptNo,
        attempt.status,
        JSON.stringify(attempt),
        attempt.createdAt,
      ],
    );
  }

  async listGenerationAttempts(storyId: string, chapterNo: number): Promise<GenerationAttempt[]> {
    const result = await this.pool.query<JsonRow>(
      `SELECT payload FROM illustration_generation_attempts
       WHERE story_id = $1 AND chapter_no = $2 ORDER BY created_at, attempt_no`,
      [storyId, chapterNo],
    );
    return result.rows.map((row) => row.payload as GenerationAttempt);
  }

  async getCurrentIllustration(storyId: string, chapterNo: number): Promise<IllustrationVersion | undefined> {
    const result = await this.pool.query<JsonRow>(
      `SELECT payload FROM chapter_illustration_versions
       WHERE story_id = $1 AND chapter_no = $2 AND is_current = true`,
      [storyId, chapterNo],
    );
    return result.rows[0]?.payload as IllustrationVersion | undefined;
  }

  async listIllustrationHistory(storyId: string, chapterNo: number): Promise<IllustrationVersion[]> {
    const result = await this.pool.query<JsonRow>(
      `SELECT payload FROM chapter_illustration_versions
       WHERE story_id = $1 AND chapter_no = $2 ORDER BY version DESC`,
      [storyId, chapterNo],
    );
    return result.rows.map((row) => row.payload as IllustrationVersion);
  }

  async promoteIllustration(version: IllustrationVersion): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockChapter(client, version.storyId, version.chapterNo);
      const archivedAt = version.createdAt;
      const currentRows = await client.query<JsonRow>(
        `SELECT payload FROM chapter_illustration_versions
         WHERE story_id = $1 AND chapter_no = $2 AND is_current = true FOR UPDATE`,
        [version.storyId, version.chapterNo],
      );
      for (const row of currentRows.rows) {
        const current = row.payload as IllustrationVersion;
        const archived: IllustrationVersion = {
          ...current,
          isCurrent: false,
          status: "archived",
          archivedAt,
        };
        await client.query(
          `UPDATE chapter_illustration_versions
           SET is_current = false, status = 'archived', payload = $2::jsonb
           WHERE illustration_id = $1`,
          [current.illustrationId, JSON.stringify(archived)],
        );
      }
      await client.query(
        `INSERT INTO chapter_illustration_versions
           (illustration_id, story_id, chapter_no, chapter_version, version, is_current, status, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, true, 'current', $6::jsonb, $7)`,
        [
          version.illustrationId,
          version.storyId,
          version.chapterNo,
          version.chapterVersion,
          version.version,
          JSON.stringify(version),
          version.createdAt,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findProcessedRequest(storyId: string, requestId: string): Promise<ProcessedIllustrationRequest | undefined> {
    const result = await this.pool.query<JsonRow>(
      "SELECT payload FROM processed_illustration_requests WHERE story_id = $1 AND request_id = $2",
      [storyId, requestId],
    );
    return result.rows[0]?.payload as ProcessedIllustrationRequest | undefined;
  }

  async saveProcessedRequest(request: ProcessedIllustrationRequest): Promise<void> {
    await this.pool.query(
      `INSERT INTO processed_illustration_requests (story_id, request_id, payload, created_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (story_id, request_id) DO NOTHING`,
      [request.storyId, request.requestId, JSON.stringify(request), request.createdAt],
    );
  }

  private async lockChapter(client: PoolClient, storyId: string, chapterNo: number): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), $2)", [storyId, chapterNo]);
  }
}
