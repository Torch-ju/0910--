CREATE TABLE IF NOT EXISTS story_visual_bibles (
  story_id text PRIMARY KEY,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'locked')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS character_visual_profiles (
  story_id text NOT NULL,
  character_id text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('main', 'supporting')),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'awaiting_approval', 'approved')),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_character_visual_profiles_name
  ON character_visual_profiles (story_id, display_name);

CREATE TABLE IF NOT EXISTS character_reference_candidates (
  candidate_id text PRIMARY KEY,
  story_id text NOT NULL,
  character_id text NOT NULL,
  visual_profile_version integer NOT NULL,
  candidate_no integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, character_id, visual_profile_version, candidate_no)
);

CREATE INDEX IF NOT EXISTS idx_reference_candidates_character
  ON character_reference_candidates (story_id, character_id, visual_profile_version);

CREATE TABLE IF NOT EXISTS illustration_generation_attempts (
  attempt_id text PRIMARY KEY,
  story_id text NOT NULL,
  chapter_no integer NOT NULL CHECK (chapter_no > 0),
  request_id text NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status text NOT NULL CHECK (status IN ('generated', 'review_rejected', 'generation_failed', 'published')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, request_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_generation_attempts_chapter
  ON illustration_generation_attempts (story_id, chapter_no, created_at);

CREATE TABLE IF NOT EXISTS chapter_illustration_versions (
  illustration_id text PRIMARY KEY,
  story_id text NOT NULL,
  chapter_no integer NOT NULL CHECK (chapter_no > 0),
  chapter_version integer NOT NULL CHECK (chapter_version > 0),
  version integer NOT NULL CHECK (version > 0),
  is_current boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('current', 'archived')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (story_id, chapter_no, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_illustration_current
  ON chapter_illustration_versions (story_id, chapter_no)
  WHERE is_current;

CREATE TABLE IF NOT EXISTS processed_illustration_requests (
  story_id text NOT NULL,
  request_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, request_id)
);
