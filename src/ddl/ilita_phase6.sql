-- ============================================================
-- ILITA — Phase 6 (NEXUS observations + document/image review)
-- Apply after core ilita schema exists. app_observations must exist.
-- If upgrading from earlier experimental document tables, drops apply.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- NEXUS observation processing (columns on existing table)
-- ------------------------------------------------------------
ALTER TABLE ilita.app_observations
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS routed_to text;

CREATE INDEX IF NOT EXISTS idx_app_observations_unprocessed
  ON ilita.app_observations (observed_at)
  WHERE processed_at IS NULL;

-- ------------------------------------------------------------
-- Document review (replaces prior experimental shape if present)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS ilita.document_reviews CASCADE;
DROP TABLE IF EXISTS ilita.documents CASCADE;

CREATE TABLE ilita.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer,
  uploader text DEFAULT 'brandon',
  status text DEFAULT 'uploaded' CHECK (status IN ('uploaded','processing','reviewed','failed')),
  is_image boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE ilita.document_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES ilita.documents(id) ON DELETE CASCADE,
  summary text NOT NULL,
  key_points jsonb DEFAULT '[]',
  drift_flags jsonb DEFAULT '[]',
  image_description text,
  model_used text,
  tokens_used integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_created_idx ON ilita.documents (created_at DESC);
CREATE INDEX IF NOT EXISTS document_reviews_doc_idx ON ilita.document_reviews (document_id, created_at DESC);

ALTER TABLE ilita.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ilita.document_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role full access docs" ON ilita.documents;
CREATE POLICY "service role full access docs"
  ON ilita.documents FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role full access reviews" ON ilita.document_reviews;
CREATE POLICY "service role full access reviews"
  ON ilita.document_reviews FOR ALL USING (auth.role() = 'service_role');

-- Optional: enable when nexus.is_super_admin() exists in the database.
-- DROP POLICY IF EXISTS "super_admin reads docs" ON ilita.documents;
-- CREATE POLICY "super_admin reads docs"
--   ON ilita.documents FOR SELECT USING (nexus.is_super_admin());
-- DROP POLICY IF EXISTS "super_admin reads reviews" ON ilita.document_reviews;
-- CREATE POLICY "super_admin reads reviews"
--   ON ilita.document_reviews FOR SELECT USING (nexus.is_super_admin());

COMMIT;
