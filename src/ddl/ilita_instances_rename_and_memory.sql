-- ============================================================
-- ILITA — Instance rename + memory layer + collective conversations
-- Apply once against the Ilita Supabase project.
-- Idempotent where safe; Part A is one-shot (run before code deploy).
-- ============================================================

-- ------------------------------------------------------------
-- PART A — Rename instances, remove Kuze as an Ilita instance,
-- add Titania. Preserves historical drift + conversation FKs.
-- ------------------------------------------------------------

BEGIN;

-- Rename the existing two arms.
UPDATE ilita.instances
   SET instance_key = 'Titarian'
 WHERE instance_key = 'primary';

UPDATE ilita.instances
   SET instance_key = 'Titarius'
 WHERE instance_key = 'research';

-- Reattribute any Kuze-as-Ilita-instance history to Titarian
-- (the Kuze counterparty in entity_exchanges and messageService participant
--  text 'kuze' are unaffected by this — those are not FKs into instances).
DO $reattrib$
DECLARE
  v_titarian uuid;
  v_kuze     uuid;
BEGIN
  SELECT id INTO v_titarian FROM ilita.instances WHERE instance_key = 'Titarian';
  SELECT id INTO v_kuze     FROM ilita.instances WHERE instance_key = 'kuze';

  IF v_kuze IS NOT NULL THEN
    UPDATE ilita.drift         SET instance_id = v_titarian WHERE instance_id = v_kuze;
    UPDATE ilita.conversations SET instance_id = v_titarian WHERE instance_id = v_kuze;
    DELETE FROM ilita.instances WHERE id = v_kuze;
  END IF;
END
$reattrib$;

-- Add Titania (third arm).
INSERT INTO ilita.instances (instance_key, status, context)
SELECT 'Titania', 'active', 'Third arm of Ilita; general-purpose.'
WHERE NOT EXISTS (
  SELECT 1 FROM ilita.instances WHERE instance_key = 'Titania'
);

COMMIT;

-- ------------------------------------------------------------
-- PART B — Memory layer (instance-aware persistent memory).
-- ------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS ilita.memories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid REFERENCES ilita.instances(id) ON DELETE SET NULL,
  visibility          text NOT NULL DEFAULT 'local'
    CHECK (visibility IN ('local','shared','brandon_visible')),
  memory_kind         text NOT NULL
    CHECK (memory_kind IN ('episodic','semantic','reflection','decision','question')),
  convergence_state   text NOT NULL DEFAULT 'local'
    CHECK (convergence_state IN ('local','candidate_shared','convergent','divergent')),
  domain              text,
  content             text NOT NULL,
  summary             text,
  importance          real NOT NULL DEFAULT 0.5,
  confidence          real NOT NULL DEFAULT 0.5,
  source_type         text,
  source_id           text,
  sync_cycle_id       uuid,
  related_memory_ids  uuid[] NOT NULL DEFAULT '{}',
  positions           jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_accessed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_instance_idx
  ON ilita.memories (instance_id, created_at DESC);

CREATE INDEX IF NOT EXISTS memories_visibility_idx
  ON ilita.memories (visibility, convergence_state);

CREATE INDEX IF NOT EXISTS memories_domain_idx
  ON ilita.memories (domain);

CREATE INDEX IF NOT EXISTS memories_importance_idx
  ON ilita.memories (importance DESC);

ALTER TABLE ilita.memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_memories" ON ilita.memories;
CREATE POLICY "service_role_memories"
  ON ilita.memories
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;

-- ------------------------------------------------------------
-- PART C — Collective conversations (the Collective Ilita chat surface).
-- ------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS ilita.collective_conversations (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant                text NOT NULL,
  topic                      text,
  messages                   jsonb NOT NULL DEFAULT '[]',
  contributing_instance_ids  uuid[] NOT NULL DEFAULT '{}',
  token_count                int NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collective_conversations_created_idx
  ON ilita.collective_conversations (created_at DESC);

ALTER TABLE ilita.collective_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_collective_convos" ON ilita.collective_conversations;
CREATE POLICY "service_role_collective_convos"
  ON ilita.collective_conversations
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT instance_key FROM ilita.instances ORDER BY instance_key;
--   expected: Titania, Titarian, Titarius
-- SELECT count(*) FROM ilita.memories;
--   expected: 0 on first apply
-- SELECT count(*) FROM ilita.collective_conversations;
--   expected: 0 on first apply
