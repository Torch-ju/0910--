CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_story_versions (
  story_id TEXT PRIMARY KEY,
  memory_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_processed_turns (
  story_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  memory_version BIGINT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (story_id, turn_id),
  UNIQUE (story_id, request_id)
);

CREATE TABLE IF NOT EXISTS memory_characters (
  character_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'provisional', 'merged', 'invalid')),
  merged_into_character_id TEXT REFERENCES memory_characters(character_id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_characters_story_name_idx
  ON memory_characters(story_id, normalized_name);

CREATE TABLE IF NOT EXISTS memory_character_aliases (
  alias_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  evidence JSONB NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_aliases_story_value_idx
  ON memory_character_aliases(story_id, normalized_value)
  WHERE confirmed = true;

CREATE TABLE IF NOT EXISTS memory_events (
  event_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  story_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL CHECK (importance >= 0 AND importance <= 1),
  evidence JSONB NOT NULL,
  memory_version BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (story_id, event_key, memory_version)
);

CREATE TABLE IF NOT EXISTS memory_event_participants (
  event_id TEXT NOT NULL REFERENCES memory_events(event_id),
  character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  PRIMARY KEY (event_id, character_id)
);

CREATE INDEX IF NOT EXISTS memory_event_participants_character_idx
  ON memory_event_participants(character_id);

CREATE TABLE IF NOT EXISTS memory_facts (
  fact_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  inference BOOLEAN NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  authority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed')),
  evidence JSONB NOT NULL,
  valid_from_version BIGINT NOT NULL,
  valid_until_version BIGINT,
  superseded_by_fact_id TEXT REFERENCES memory_facts(fact_id),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_facts_character_key_status_idx
  ON memory_facts(character_id, key, status);

CREATE TABLE IF NOT EXISTS memory_relationships (
  relationship_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  from_character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  to_character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL CHECK (importance >= 0 AND importance <= 1),
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
  is_important BOOLEAN NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'disputed')),
  evidence JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_relationships_from_idx
  ON memory_relationships(from_character_id, status);
CREATE INDEX IF NOT EXISTS memory_relationships_to_idx
  ON memory_relationships(to_character_id, status);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  conflict_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact_conflict', 'identity_ambiguity', 'same_name_ambiguity')),
  character_ids TEXT[] NOT NULL,
  description TEXT NOT NULL,
  evidence_ids TEXT[] NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS memory_conflicts_story_status_idx
  ON memory_conflicts(story_id, status);

CREATE TABLE IF NOT EXISTS memory_corrections (
  correction_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  old_fact_id TEXT NOT NULL REFERENCES memory_facts(fact_id),
  new_fact_id TEXT NOT NULL REFERENCES memory_facts(fact_id),
  reason TEXT NOT NULL,
  automatic BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_identity_changes (
  identity_change_id BIGSERIAL PRIMARY KEY,
  story_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('merge', 'split', 'invalidate')),
  source_character_ids TEXT[] NOT NULL,
  target_character_ids TEXT[] NOT NULL,
  memory_version BIGINT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_notifications (
  notification_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('automatic_correction', 'identity_needs_confirmation', 'memory_conflict')),
  message TEXT NOT NULL,
  related_character_ids TEXT[] NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS memory_notifications_story_status_idx
  ON memory_notifications(story_id, status);

CREATE TABLE IF NOT EXISTS memory_portrait_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  character_id TEXT NOT NULL REFERENCES memory_characters(character_id),
  memory_version BIGINT NOT NULL,
  schema_version TEXT NOT NULL,
  portrait JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (character_id, memory_version, schema_version)
);

CREATE INDEX IF NOT EXISTS memory_portraits_latest_idx
  ON memory_portrait_snapshots(character_id, memory_version DESC);

-- The embedding dimension is isolated here so it can be changed when a provider is selected.
CREATE TABLE IF NOT EXISTS memory_embeddings (
  embedding_id BIGSERIAL PRIMARY KEY,
  story_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('event', 'portrait', 'relationship')),
  memory_id TEXT NOT NULL,
  content_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (memory_type, memory_id)
);

CREATE INDEX IF NOT EXISTS memory_embeddings_story_type_idx
  ON memory_embeddings(story_id, memory_type);
CREATE INDEX IF NOT EXISTS memory_embeddings_vector_idx
  ON memory_embeddings USING hnsw (embedding vector_cosine_ops);
