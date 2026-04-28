-- ============================================================
-- ILITA SCHEMA — Phase 5 Addition
-- BioLoop Pattern Cache
-- Run against nexus-core after ilita_ddl.sql
-- ============================================================

BEGIN;

-- Local cache of BioLoop patterns Ilita has received
-- Used as fallback when BioLoop API is unavailable
-- Also used for push-mode delivery from BioLoop
CREATE TABLE ilita.bioloop_pattern_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  domain TEXT,
  payload JSONB DEFAULT '{}',
  source TEXT DEFAULT 'bioloop',
  processed_by_ilita BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX bioloop_cache_processed_idx
  ON ilita.bioloop_pattern_cache (processed_by_ilita)
  WHERE processed_by_ilita = FALSE;

CREATE INDEX bioloop_cache_domain_idx
  ON ilita.bioloop_pattern_cache (domain);

CREATE INDEX bioloop_cache_created_idx
  ON ilita.bioloop_pattern_cache (created_at DESC);

-- RLS
ALTER TABLE ilita.bioloop_pattern_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access"
  ON ilita.bioloop_pattern_cache
  FOR ALL USING (auth.role() = 'service_role');

-- Ingest log — record of every ingest cycle
CREATE TABLE ilita.bioloop_ingest_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patterns_processed INT DEFAULT 0,
  drift_written INT DEFAULT 0,
  threads_updated INT DEFAULT 0,
  questions_created INT DEFAULT 0,
  flags_created INT DEFAULT 0,
  trigger TEXT DEFAULT 'scheduled'
    CHECK (trigger IN ('scheduled', 'push', 'manual')),
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ilita.bioloop_ingest_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access"
  ON ilita.bioloop_ingest_log
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT tablename FROM pg_tables WHERE schemaname = 'ilita' ORDER BY tablename;
-- SELECT COUNT(*) FROM ilita.bioloop_pattern_cache;
-- SELECT COUNT(*) FROM ilita.bioloop_ingest_log;
