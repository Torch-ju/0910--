import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";

import type {
  AliasRecord,
  CharacterRecord,
  ConflictRecord,
  CorrectionRecord,
  EventRecord,
  FactRecord,
  PortraitSnapshot,
  ProcessedTurnRecord,
  RelationshipRecord,
  RetrievalQuery,
  RetrievedMemory,
  SplitCharacterInput,
  UserNotification,
} from "../domain.js";
import type { ExtractionContext, MemoryRepository, MemoryTransaction } from "../ports.js";

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapCharacter(row: QueryResultRow): CharacterRecord {
  const record: CharacterRecord = {
    characterId: row.character_id,
    storyId: row.story_id,
    displayName: row.display_name,
    normalizedName: row.normalized_name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.merged_into_character_id) record.mergedIntoCharacterId = row.merged_into_character_id;
  return record;
}

function mapAlias(row: QueryResultRow): AliasRecord {
  return {
    aliasId: row.alias_id,
    storyId: row.story_id,
    characterId: row.character_id,
    value: row.value,
    normalizedValue: row.normalized_value,
    evidence: row.evidence,
    confirmed: row.confirmed,
    createdAt: iso(row.created_at),
  };
}

function mapFact(row: QueryResultRow): FactRecord {
  const record: FactRecord = {
    factId: row.fact_id,
    storyId: row.story_id,
    characterId: row.character_id,
    key: row.key,
    value: row.value,
    inference: row.inference,
    confidence: row.confidence,
    authority: row.authority,
    status: row.status,
    evidence: row.evidence,
    validFromVersion: Number(row.valid_from_version),
    createdAt: iso(row.created_at),
  };
  if (row.valid_until_version !== null) record.validUntilVersion = Number(row.valid_until_version);
  if (row.superseded_by_fact_id) record.supersededByFactId = row.superseded_by_fact_id;
  return record;
}

function mapRelationship(row: QueryResultRow): RelationshipRecord {
  return {
    relationshipId: row.relationship_id,
    storyId: row.story_id,
    fromCharacterId: row.from_character_id,
    toCharacterId: row.to_character_id,
    type: row.type,
    description: row.description,
    importance: row.importance,
    occurrenceCount: row.occurrence_count,
    isImportant: row.is_important,
    status: row.status,
    evidence: row.evidence,
    updatedAt: iso(row.updated_at),
  };
}

function mapConflict(row: QueryResultRow): ConflictRecord {
  const record: ConflictRecord = {
    conflictId: row.conflict_id,
    storyId: row.story_id,
    type: row.type,
    characterIds: row.character_ids,
    description: row.description,
    evidenceIds: row.evidence_ids,
    status: row.status,
    createdAt: iso(row.created_at),
  };
  if (row.resolved_at) record.resolvedAt = iso(row.resolved_at);
  return record;
}

function mapEvent(row: QueryResultRow): EventRecord {
  return {
    eventId: row.event_id,
    eventKey: row.event_key,
    storyId: row.story_id,
    summary: row.summary,
    participantIds: row.participant_ids ?? [],
    importance: row.importance,
    evidence: row.evidence,
    memoryVersion: Number(row.memory_version),
    createdAt: iso(row.created_at),
  };
}

function mapPortrait(row: QueryResultRow): PortraitSnapshot {
  return {
    snapshotId: row.snapshot_id,
    storyId: row.story_id,
    characterId: row.character_id,
    memoryVersion: Number(row.memory_version),
    schemaVersion: row.schema_version,
    portrait: row.portrait,
    createdAt: iso(row.created_at),
  };
}

function mapProcessedTurn(row: QueryResultRow): ProcessedTurnRecord {
  return {
    storyId: row.story_id,
    turnId: row.turn_id,
    requestId: row.request_id,
    memoryVersion: Number(row.memory_version),
    result: row.result,
    createdAt: iso(row.created_at),
  };
}

export class PostgresMemoryRepository implements MemoryRepository {
  readonly pool: Pool;

  constructor(config: PoolConfig | Pool) {
    this.pool = config instanceof Pool ? config : new Pool(config);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(storyId: string, operation: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [storyId]);
      await client.query(
        `INSERT INTO memory_story_versions(story_id, memory_version)
         VALUES ($1, 0)
         ON CONFLICT (story_id) DO NOTHING`,
        [storyId],
      );
      const result = await operation(new PostgresTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findProcessedTurn(
    storyId: string,
    requestId: string,
    turnId: string,
  ): Promise<ProcessedTurnRecord | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM memory_processed_turns
       WHERE story_id = $1 AND (request_id = $2 OR turn_id = $3)
       LIMIT 1`,
      [storyId, requestId, turnId],
    );
    return result.rows[0] ? mapProcessedTurn(result.rows[0]) : undefined;
  }

  async getExtractionContext(storyId: string): Promise<ExtractionContext> {
    const [versionResult, characterResult, eventResult, conflictResult] = await Promise.all([
      this.pool.query("SELECT memory_version FROM memory_story_versions WHERE story_id = $1", [storyId]),
      this.pool.query(
        `SELECT c.character_id, c.display_name,
                COALESCE(array_agg(DISTINCT a.value) FILTER (WHERE a.confirmed), '{}') AS aliases,
                COALESCE(jsonb_object_agg(f.key, f.values) FILTER (WHERE f.key IS NOT NULL), '{}') AS current_facts
         FROM memory_characters c
         LEFT JOIN memory_character_aliases a ON a.character_id = c.character_id
         LEFT JOIN (
           SELECT character_id, key, jsonb_agg(DISTINCT value) AS values
           FROM memory_facts WHERE status = 'active' GROUP BY character_id, key
         ) f ON f.character_id = c.character_id
         WHERE c.story_id = $1 AND c.status NOT IN ('merged', 'invalid')
         GROUP BY c.character_id, c.display_name`,
        [storyId],
      ),
      this.pool.query(
        `SELECT e.event_id, e.summary, array_agg(ep.character_id) AS participant_ids
         FROM memory_events e
         JOIN memory_event_participants ep ON ep.event_id = e.event_id
         WHERE e.story_id = $1
         GROUP BY e.event_id
         ORDER BY e.memory_version DESC, e.created_at DESC
         LIMIT 30`,
        [storyId],
      ),
      this.pool.query(
        "SELECT * FROM memory_conflicts WHERE story_id = $1 AND status = 'pending' ORDER BY created_at",
        [storyId],
      ),
    ]);
    return {
      memoryVersion: Number(versionResult.rows[0]?.memory_version ?? 0),
      characters: characterResult.rows.map((row) => ({
        characterId: row.character_id,
        displayName: row.display_name,
        aliases: row.aliases,
        currentFacts: row.current_facts,
      })),
      recentEvents: eventResult.rows.map((row) => ({
        eventId: row.event_id,
        summary: row.summary,
        participantIds: row.participant_ids,
      })),
      pendingConflicts: conflictResult.rows.map(mapConflict),
    };
  }

  async getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM memory_portrait_snapshots
       WHERE character_id = $1 ORDER BY memory_version DESC LIMIT 1`,
      [characterId],
    );
    return result.rows[0] ? mapPortrait(result.rows[0]) : undefined;
  }

  async listEvents(characterId: string, limit = 100): Promise<EventRecord[]> {
    const result = await this.pool.query(
      `SELECT e.*, array_agg(ep_all.character_id) AS participant_ids
       FROM memory_events e
       JOIN memory_event_participants selected
         ON selected.event_id = e.event_id AND selected.character_id = $1
       JOIN memory_event_participants ep_all ON ep_all.event_id = e.event_id
       GROUP BY e.event_id
       ORDER BY e.memory_version, e.created_at
       LIMIT $2`,
      [characterId, limit],
    );
    return result.rows.map(mapEvent);
  }

  async listRelationships(characterId: string): Promise<RelationshipRecord[]> {
    const result = await this.pool.query(
      `SELECT * FROM memory_relationships
       WHERE status = 'active' AND (from_character_id = $1 OR to_character_id = $1)
       ORDER BY importance DESC, updated_at DESC`,
      [characterId],
    );
    return result.rows.map(mapRelationship);
  }

  async search(query: RetrievalQuery): Promise<RetrievedMemory[]> {
    if (query.queryEmbedding && query.queryEmbedding.length !== 1536) {
      throw new Error(`Expected a 1536-dimensional query embedding, received ${query.queryEmbedding.length}`);
    }
    const embedding = query.queryEmbedding ? `[${query.queryEmbedding.join(",")}]` : null;
    const characterIds = query.currentCharacterIds ?? [];
    const [result, conflictResult] = await Promise.all([
      this.pool.query(
      `SELECT memory_type, memory_id, content_text, metadata,
              LEAST(1,
                CASE WHEN $3::vector IS NOT NULL AND embedding IS NOT NULL
                  THEN GREATEST(0, 1 - (embedding <=> $3::vector)) * 0.50 ELSE 0 END
                + CASE WHEN content_text ILIKE '%' || $2 || '%' THEN 0.25 ELSE 0 END
                + CASE WHEN memory_type='portrait' AND metadata->'characterIds' ?| $4::text[] THEN 0.60
                       WHEN metadata->'characterIds' ?| $4::text[] THEN 0.20 ELSE 0 END
                + CASE WHEN $5::int IS NOT NULL AND (metadata->>'chapterNo')::int=$5 THEN 0.04 ELSE 0 END
                + CASE WHEN $6::int IS NOT NULL AND (metadata->>'sceneNo')::int=$6 THEN 0.03 ELSE 0 END
                + COALESCE((metadata->>'importance')::double precision, 0) * 0.05
              ) AS score
       FROM memory_embeddings
       WHERE story_id = $1
         AND (
           memory_type <> 'portrait'
           OR memory_id IN (
             SELECT DISTINCT ON (character_id) snapshot_id
             FROM memory_portrait_snapshots
             WHERE story_id=$1
             ORDER BY character_id, memory_version DESC
           )
         )
       ORDER BY score DESC, created_at DESC
       LIMIT $7`,
        [
          query.storyId,
          query.queryText,
          embedding,
          characterIds,
          query.chapterNo ?? null,
          query.sceneNo ?? null,
          query.limit ?? 20,
        ],
      ),
      this.pool.query(
        `SELECT * FROM memory_conflicts
         WHERE story_id=$1 AND status='pending'
           AND (cardinality($2::text[]) = 0 OR character_ids && $2::text[])
         ORDER BY created_at DESC`,
        [query.storyId, characterIds],
      ),
    ]);
    const memories: RetrievedMemory[] = result.rows.map((row) => ({
      memoryType: row.memory_type,
      memoryId: row.memory_id,
      content: { text: row.content_text, metadata: row.metadata },
      score: Number(row.score),
      reason: [
        ...(embedding ? ["vector_similarity"] : []),
        ...(characterIds.length > 0 ? ["character_filter"] : []),
        "structured_authority_first",
      ],
    }));
    memories.push(
      ...conflictResult.rows.map((row) => ({
        memoryType: "conflict" as const,
        memoryId: row.conflict_id as string,
        content: mapConflict(row),
        score: 1,
        reason: ["unresolved_conflict", "must_include"],
      })),
    );
    return memories.sort((left, right) => right.score - left.score).slice(0, query.limit ?? 20);
  }

  async listPendingNotifications(storyId: string): Promise<UserNotification[]> {
    const result = await this.pool.query(
      `SELECT * FROM memory_notifications
       WHERE story_id=$1 AND status='pending' ORDER BY created_at`,
      [storyId],
    );
    return result.rows.map((row) => ({
      notificationId: row.notification_id,
      storyId: row.story_id,
      type: row.type,
      message: row.message,
      relatedCharacterIds: row.related_character_ids,
      status: row.status,
      createdAt: iso(row.created_at),
    }));
  }

  async updateNotificationStatus(
    storyId: string,
    notificationId: string,
    status: "delivered" | "acknowledged",
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE memory_notifications SET status=$3
       WHERE story_id=$1 AND notification_id=$2`,
      [storyId, notificationId, status],
    );
    if (result.rowCount !== 1) throw new Error(`Notification not found: ${notificationId}`);
  }
}

class PostgresTransaction implements MemoryTransaction {
  constructor(private readonly client: PoolClient) {}

  async getMemoryVersion(storyId: string): Promise<number> {
    const result = await this.client.query(
      "SELECT memory_version FROM memory_story_versions WHERE story_id = $1 FOR UPDATE",
      [storyId],
    );
    return Number(result.rows[0]?.memory_version ?? 0);
  }

  async setMemoryVersion(storyId: string, version: number): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_story_versions(story_id, memory_version, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (story_id) DO UPDATE
       SET memory_version = EXCLUDED.memory_version, updated_at = now()`,
      [storyId, version],
    );
  }

  async findProcessedTurn(
    storyId: string,
    requestId: string,
    turnId: string,
  ): Promise<ProcessedTurnRecord | undefined> {
    const result = await this.client.query(
      `SELECT * FROM memory_processed_turns
       WHERE story_id = $1 AND (request_id = $2 OR turn_id = $3)
       LIMIT 1`,
      [storyId, requestId, turnId],
    );
    return result.rows[0] ? mapProcessedTurn(result.rows[0]) : undefined;
  }

  async listCharacters(storyId: string): Promise<CharacterRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM memory_characters WHERE story_id = $1 ORDER BY created_at",
      [storyId],
    );
    return result.rows.map(mapCharacter);
  }

  async getCharacter(characterId: string): Promise<CharacterRecord | undefined> {
    const result = await this.client.query(
      "SELECT * FROM memory_characters WHERE character_id = $1",
      [characterId],
    );
    return result.rows[0] ? mapCharacter(result.rows[0]) : undefined;
  }

  async findCharactersByName(storyId: string, normalizedName: string): Promise<CharacterRecord[]> {
    const result = await this.client.query(
      `SELECT DISTINCT c.* FROM memory_characters c
       LEFT JOIN memory_character_aliases a
         ON a.character_id = c.character_id AND a.confirmed = true
       WHERE c.story_id = $1
         AND c.status NOT IN ('merged', 'invalid')
         AND (c.normalized_name = $2 OR a.normalized_value = $2)`,
      [storyId, normalizedName],
    );
    return result.rows.map(mapCharacter);
  }

  async createCharacter(character: CharacterRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_characters(
        character_id, story_id, display_name, normalized_name, status,
        merged_into_character_id, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        character.characterId,
        character.storyId,
        character.displayName,
        character.normalizedName,
        character.status,
        character.mergedIntoCharacterId ?? null,
        character.createdAt,
        character.updatedAt,
      ],
    );
  }

  async updateCharacter(character: CharacterRecord): Promise<void> {
    await this.client.query(
      `UPDATE memory_characters
       SET display_name=$2, normalized_name=$3, status=$4,
           merged_into_character_id=$5, updated_at=$6
       WHERE character_id=$1`,
      [
        character.characterId,
        character.displayName,
        character.normalizedName,
        character.status,
        character.mergedIntoCharacterId ?? null,
        character.updatedAt,
      ],
    );
  }

  async listAliases(characterId: string): Promise<AliasRecord[]> {
    const result = await this.client.query(
      "SELECT * FROM memory_character_aliases WHERE character_id = $1 ORDER BY created_at",
      [characterId],
    );
    return result.rows.map(mapAlias);
  }

  async createAlias(alias: AliasRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_character_aliases(
        alias_id, story_id, character_id, value, normalized_value, evidence, confirmed, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        alias.aliasId,
        alias.storyId,
        alias.characterId,
        alias.value,
        alias.normalizedValue,
        JSON.stringify(alias.evidence),
        alias.confirmed,
        alias.createdAt,
      ],
    );
  }

  async appendEvent(event: EventRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_events(
        event_id, event_key, story_id, summary, importance, evidence, memory_version, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        event.eventId,
        event.eventKey,
        event.storyId,
        event.summary,
        event.importance,
        JSON.stringify(event.evidence),
        event.memoryVersion,
        event.createdAt,
      ],
    );
    for (const characterId of event.participantIds) {
      await this.client.query(
        `INSERT INTO memory_event_participants(event_id, character_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [event.eventId, characterId],
      );
    }
    await this.upsertEmbedding(
      event.storyId,
      "event",
      event.eventId,
      event.summary,
      {
        characterIds: event.participantIds,
        importance: event.importance,
        chapterNo: event.evidence.chapterNo,
        sceneNo: event.evidence.sceneNo,
      },
    );
  }

  async listEvents(characterId: string, limit = 100): Promise<EventRecord[]> {
    const result = await this.client.query(
      `SELECT e.*, array_agg(ep_all.character_id) AS participant_ids
       FROM memory_events e
       JOIN memory_event_participants selected
         ON selected.event_id=e.event_id AND selected.character_id=$1
       JOIN memory_event_participants ep_all ON ep_all.event_id=e.event_id
       GROUP BY e.event_id ORDER BY e.memory_version, e.created_at LIMIT $2`,
      [characterId, limit],
    );
    return result.rows.map(mapEvent);
  }

  async listActiveFacts(characterId: string, key?: string): Promise<FactRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM memory_facts
       WHERE character_id=$1 AND status='active' AND ($2::text IS NULL OR key=$2)
       ORDER BY valid_from_version, created_at`,
      [characterId, key ?? null],
    );
    return result.rows.map(mapFact);
  }

  async createFact(fact: FactRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_facts(
        fact_id, story_id, character_id, key, value, inference, confidence,
        authority, status, evidence, valid_from_version, valid_until_version,
        superseded_by_fact_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)`,
      [
        fact.factId,
        fact.storyId,
        fact.characterId,
        fact.key,
        fact.value,
        fact.inference,
        fact.confidence,
        fact.authority,
        fact.status,
        JSON.stringify(fact.evidence),
        fact.validFromVersion,
        fact.validUntilVersion ?? null,
        fact.supersededByFactId ?? null,
        fact.createdAt,
      ],
    );
  }

  async updateFact(fact: FactRecord): Promise<void> {
    await this.client.query(
      `UPDATE memory_facts SET status=$2, valid_until_version=$3, superseded_by_fact_id=$4
       WHERE fact_id=$1`,
      [fact.factId, fact.status, fact.validUntilVersion ?? null, fact.supersededByFactId ?? null],
    );
  }

  async findRelationship(
    storyId: string,
    fromCharacterId: string,
    toCharacterId: string,
    type: string,
  ): Promise<RelationshipRecord | undefined> {
    const result = await this.client.query(
      `SELECT * FROM memory_relationships
       WHERE story_id=$1 AND from_character_id=$2 AND to_character_id=$3
         AND type=$4 AND status='active'
       ORDER BY updated_at DESC LIMIT 1`,
      [storyId, fromCharacterId, toCharacterId, type],
    );
    return result.rows[0] ? mapRelationship(result.rows[0]) : undefined;
  }

  async saveRelationship(relationship: RelationshipRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_relationships(
        relationship_id, story_id, from_character_id, to_character_id, type,
        description, importance, occurrence_count, is_important, status, evidence, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
      ON CONFLICT (relationship_id) DO UPDATE SET
        description=EXCLUDED.description, importance=EXCLUDED.importance,
        occurrence_count=EXCLUDED.occurrence_count, is_important=EXCLUDED.is_important,
        status=EXCLUDED.status, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`,
      [
        relationship.relationshipId,
        relationship.storyId,
        relationship.fromCharacterId,
        relationship.toCharacterId,
        relationship.type,
        relationship.description,
        relationship.importance,
        relationship.occurrenceCount,
        relationship.isImportant,
        relationship.status,
        JSON.stringify(relationship.evidence),
        relationship.updatedAt,
      ],
    );
    await this.upsertEmbedding(
      relationship.storyId,
      "relationship",
      relationship.relationshipId,
      `${relationship.type} ${relationship.description}`,
      {
        characterIds: [relationship.fromCharacterId, relationship.toCharacterId],
        importance: relationship.importance,
      },
    );
  }

  async listRelationships(characterId: string): Promise<RelationshipRecord[]> {
    const result = await this.client.query(
      `SELECT * FROM memory_relationships
       WHERE status='active' AND (from_character_id=$1 OR to_character_id=$1)
       ORDER BY importance DESC, updated_at DESC`,
      [characterId],
    );
    return result.rows.map(mapRelationship);
  }

  async createConflict(conflict: ConflictRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_conflicts(
        conflict_id, story_id, type, character_ids, description,
        evidence_ids, status, created_at, resolved_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        conflict.conflictId,
        conflict.storyId,
        conflict.type,
        conflict.characterIds,
        conflict.description,
        conflict.evidenceIds,
        conflict.status,
        conflict.createdAt,
        conflict.resolvedAt ?? null,
      ],
    );
  }

  async createCorrection(correction: CorrectionRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_corrections(
        correction_id, story_id, character_id, old_fact_id, new_fact_id,
        reason, automatic, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        correction.correctionId,
        correction.storyId,
        correction.characterId,
        correction.oldFactId,
        correction.newFactId,
        correction.reason,
        correction.automatic,
        correction.createdAt,
      ],
    );
  }

  async createNotification(notification: UserNotification): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_notifications(
        notification_id, story_id, type, message, related_character_ids, status, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        notification.notificationId,
        notification.storyId,
        notification.type,
        notification.message,
        notification.relatedCharacterIds,
        notification.status,
        notification.createdAt,
      ],
    );
  }

  async savePortrait(snapshot: PortraitSnapshot): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_portrait_snapshots(
        snapshot_id, story_id, character_id, memory_version,
        schema_version, portrait, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [
        snapshot.snapshotId,
        snapshot.storyId,
        snapshot.characterId,
        snapshot.memoryVersion,
        snapshot.schemaVersion,
        JSON.stringify(snapshot.portrait),
        snapshot.createdAt,
      ],
    );
    await this.upsertEmbedding(
      snapshot.storyId,
      "portrait",
      snapshot.snapshotId,
      JSON.stringify(snapshot.portrait),
      { characterIds: [snapshot.characterId], memoryVersion: snapshot.memoryVersion },
    );
  }

  async getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined> {
    const result = await this.client.query(
      `SELECT * FROM memory_portrait_snapshots
       WHERE character_id=$1 ORDER BY memory_version DESC LIMIT 1`,
      [characterId],
    );
    return result.rows[0] ? mapPortrait(result.rows[0]) : undefined;
  }

  async mergeCharacters(
    sourceCharacterId: string,
    targetCharacterId: string,
    memoryVersion: number,
  ): Promise<void> {
    if (sourceCharacterId === targetCharacterId) return;
    const source = await this.getCharacter(sourceCharacterId);
    const target = await this.getCharacter(targetCharacterId);
    if (!source || !target) throw new Error("Cannot merge missing characters");

    await this.client.query(
      `UPDATE memory_characters
       SET status='merged', merged_into_character_id=$2, updated_at=now()
       WHERE character_id=$1`,
      [sourceCharacterId, targetCharacterId],
    );
    await this.client.query(
      "UPDATE memory_character_aliases SET character_id=$2 WHERE character_id=$1",
      [sourceCharacterId, targetCharacterId],
    );
    await this.client.query(
      "UPDATE memory_facts SET character_id=$2 WHERE character_id=$1",
      [sourceCharacterId, targetCharacterId],
    );
    await this.client.query(
      `INSERT INTO memory_event_participants(event_id, character_id)
       SELECT event_id, $2 FROM memory_event_participants WHERE character_id=$1
       ON CONFLICT DO NOTHING`,
      [sourceCharacterId, targetCharacterId],
    );
    await this.client.query(
      "DELETE FROM memory_event_participants WHERE character_id=$1",
      [sourceCharacterId],
    );
    await this.client.query(
      `UPDATE memory_relationships SET
        from_character_id=CASE WHEN from_character_id=$1 THEN $2 ELSE from_character_id END,
        to_character_id=CASE WHEN to_character_id=$1 THEN $2 ELSE to_character_id END,
        updated_at=now()
       WHERE from_character_id=$1 OR to_character_id=$1`,
      [sourceCharacterId, targetCharacterId],
    );
    await this.client.query(
      `UPDATE memory_relationships SET status='superseded', updated_at=now()
       WHERE from_character_id=to_character_id AND status='active'`,
    );
    await this.client.query(
      `INSERT INTO memory_identity_changes(
        story_id, change_type, source_character_ids, target_character_ids,
        memory_version, reason
      ) VALUES ($1,'merge',$2,$3,$4,$5)`,
      [
        source.storyId,
        [sourceCharacterId],
        [targetCharacterId],
        memoryVersion,
        "Authorized narration, explicit identity reveal, or user confirmation",
      ],
    );
  }

  async splitCharacter(input: SplitCharacterInput, memoryVersion: number): Promise<void> {
    const source = await this.getCharacter(input.sourceMergedCharacterId);
    const target = await this.getCharacter(input.currentCanonicalCharacterId);
    if (!source || !target) throw new Error("Cannot split missing characters");
    if (source.status !== "merged" || source.mergedIntoCharacterId !== target.characterId) {
      throw new Error("The requested source is not merged into the canonical character");
    }

    await this.client.query(
      `UPDATE memory_characters
       SET status='active', merged_into_character_id=NULL, updated_at=now()
       WHERE character_id=$1`,
      [source.characterId],
    );
    if (input.assignments.aliasIds.length > 0) {
      await this.client.query(
        `UPDATE memory_character_aliases SET character_id=$1
         WHERE character_id=$2 AND alias_id = ANY($3::text[])`,
        [source.characterId, target.characterId, input.assignments.aliasIds],
      );
    }
    if (input.assignments.factIds.length > 0) {
      await this.client.query(
        `UPDATE memory_facts SET character_id=$1
         WHERE character_id=$2 AND fact_id = ANY($3::text[])`,
        [source.characterId, target.characterId, input.assignments.factIds],
      );
    }
    for (const eventId of input.assignments.eventIds) {
      await this.client.query(
        `INSERT INTO memory_event_participants(event_id, character_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [eventId, source.characterId],
      );
      await this.client.query(
        `DELETE FROM memory_event_participants
         WHERE event_id=$1 AND character_id=$2`,
        [eventId, target.characterId],
      );
    }
    for (const relationship of input.assignments.relationshipEndpoints) {
      const column = relationship.endpoint === "from" ? "from_character_id" : "to_character_id";
      await this.client.query(
        `UPDATE memory_relationships SET ${column}=$1, updated_at=now()
         WHERE relationship_id=$2 AND ${column}=$3`,
        [source.characterId, relationship.relationshipId, target.characterId],
      );
    }
    await this.client.query(
      `INSERT INTO memory_identity_changes(
        story_id, change_type, source_character_ids, target_character_ids,
        memory_version, reason
      ) VALUES ($1,'split',$2,$3,$4,$5)`,
      [
        input.storyId,
        [target.characterId],
        [target.characterId, source.characterId],
        memoryVersion,
        input.reason,
      ],
    );
  }

  async saveProcessedTurn(record: ProcessedTurnRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_processed_turns(
        story_id, turn_id, request_id, memory_version, result, created_at
      ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        record.storyId,
        record.turnId,
        record.requestId,
        record.memoryVersion,
        JSON.stringify(record.result),
        record.createdAt,
      ],
    );
  }

  private async upsertEmbedding(
    storyId: string,
    memoryType: "event" | "portrait" | "relationship",
    memoryId: string,
    contentText: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.client.query(
      `INSERT INTO memory_embeddings(story_id, memory_type, memory_id, content_text, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       ON CONFLICT (memory_type, memory_id) DO UPDATE SET
         content_text=EXCLUDED.content_text, metadata=EXCLUDED.metadata`,
      [storyId, memoryType, memoryId, contentText, JSON.stringify(metadata)],
    );
  }
}
