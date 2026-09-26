-- 0002_case_workspace.sql
-- What: collaborative case workspace — cases, case_messages, case_participants,
--       case_documents tables; RLS; realtime publication; case-documents storage bucket.
-- Why:  operations teammates collaborate on a case (shared chat, document uploads,
--       @agent replies) so case data must live in the shared DB, not localStorage.
--
-- Apply in the Supabase SQL editor. Two transactions:
--   1) tables + RLS + realtime (must succeed as a unit)
--   2) storage bucket + policies (on some projects CREATE POLICY on storage.objects
--      fails with "must be owner of table objects" — if so, create the same three
--      policies in Dashboard → Storage → case-documents → Policies instead)
--
-- Reseed-proof by design: account_number / user ids are plain text, never FKs to
-- seeded tables ("Account", "User" get new CUIDs on every `npm run db:seed`).

BEGIN;

CREATE TABLE public.cases (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  account_number   text,
  household_name   text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  selected_agent   text,
  created_by       text NOT NULL,
  created_by_name  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.case_messages (
  id           text PRIMARY KEY,
  case_id      text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  author_id    text NOT NULL,
  author_name  text NOT NULL,
  author_type  text NOT NULL DEFAULT 'user' CHECK (author_type IN ('user', 'agent', 'system')),
  agent        text,
  content      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_messages_case_created_idx ON public.case_messages (case_id, created_at);

CREATE TABLE public.case_participants (
  case_id    text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  user_name  text NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

CREATE TABLE public.case_documents (
  id                text PRIMARY KEY,
  case_id           text NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  uploaded_by       text NOT NULL,
  uploaded_by_name  text NOT NULL,
  file_name         text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  storage_path      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX case_documents_case_created_idx ON public.case_documents (case_id, created_at);

-- The app talks to the DB with the anon key end-to-end; API routes (session cookie)
-- are the auth gate. Permissive RLS keeps parity with the rest of the schema while
-- still satisfying realtime's SELECT check.
ALTER TABLE public.cases             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents    ENABLE ROW LEVEL SECURITY;

CREATE POLICY cases_all             ON public.cases             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY case_messages_all     ON public.case_messages     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY case_participants_all ON public.case_participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY case_documents_all    ON public.case_documents    FOR ALL USING (true) WITH CHECK (true);

-- Live updates: sidebar case list, case thread, documents panel, header state.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.cases,
  public.case_messages,
  public.case_participants,
  public.case_documents;

COMMIT;

-- ── Storage (separate transaction — see header note) ──────────────────────────

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('case-documents', 'case-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY case_docs_select ON storage.objects FOR SELECT
  USING (bucket_id = 'case-documents');
CREATE POLICY case_docs_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'case-documents');
CREATE POLICY case_docs_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'case-documents');

COMMIT;

-- Verify after applying:
--   select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'case%';
--   select id, public from storage.buckets where id = 'case-documents';
