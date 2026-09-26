-- 0007_conversations.sql
-- What: durable chat history — conversations, conversation_messages; RLS.
-- Why:  the sidebar's History section was placeholder data (ten hardcoded titles in
--       localStorage, rows with no click handler) and the chat page never persisted its
--       messages at all. Conversations now save as they happen and can be reopened.
--
-- Apply in the Supabase SQL editor. Single transaction.
--
-- Reseed-proof by design, same as 0002_case_workspace.sql: created_by is plain text,
-- never a FK to a seeded table ("Account", "User" get new CUIDs on every `npm run db:seed`).
--
-- Deliberately NOT added to supabase_realtime: unlike cases, a conversation is private to
-- one user, so there is no second client to sync.

BEGIN;

CREATE TABLE public.conversations (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  kind             text NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'alert', 'report')),
  pinned           boolean NOT NULL DEFAULT false,
  account_number   text,
  account_name     text,
  household_name   text,
  created_by       text NOT NULL,
  created_by_name  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- The sidebar's only query: this user's conversations, most recent first.
CREATE INDEX conversations_owner_updated_idx
  ON public.conversations (created_by, updated_at DESC);

CREATE TABLE public.conversation_messages (
  id               text PRIMARY KEY,
  conversation_id  text NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  -- Stable render order, independent of timestamp collisions within a fast turn.
  seq              integer NOT NULL,
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  content          text NOT NULL,
  -- ChatReference[] from src/components/ai-chat/types.ts. Named "refs" because
  -- REFERENCES is a reserved word in PostgreSQL.
  refs             jsonb,
  -- One discriminated-union column rather than a column per card type: the chat page's
  -- Msg card variants are mutually exclusive, and adding one shouldn't need a migration.
  -- See StoredCard in src/lib/conversations.ts. Export file bytes are never stored.
  card             jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX conversation_messages_conv_seq_idx
  ON public.conversation_messages (conversation_id, seq);

-- The app talks to the DB with the anon key end-to-end; the API routes (session cookie
-- plus an explicit created_by ownership check) are the auth gate. Permissive RLS keeps
-- parity with the rest of the schema.
ALTER TABLE public.conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_all         ON public.conversations         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY conversation_messages_all ON public.conversation_messages FOR ALL USING (true) WITH CHECK (true);

COMMIT;

-- Verify after applying:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'conversation%';
--   select indexname from pg_indexes where tablename like 'conversation%';
