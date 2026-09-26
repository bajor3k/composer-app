-- 0004_alerts.sql
-- What: the Alert Center — `alerts` (standing rules) and `alert_events` (triggered
--       occurrences); indexes, RLS, realtime publication.
-- Why:  alerts fire on a schedule from a cron route and must be visible to every
--       advisor session, so rules and their triggers live in the shared DB rather
--       than localStorage (where saved report commands still live today).
--
-- Apply in the Supabase SQL editor. Single transaction — no storage bucket needed.
--
-- Reseed-proof by design: scope is stored as plain-text account_number /
-- household_id, never FKs to seeded tables ("Account", "User" and
-- "AccountPerformance" all get new CUIDs on every `npm run db:seed`). After a
-- reseed a scoped alert may point at an account that no longer exists; the
-- evaluator skips it and writes `last_error`, which the Alert Center renders as a
-- "Scope not found" pill. That is expected behaviour, not a bug.
--
-- Purely additive: two new tables, no existing view or column is touched, so the
-- legacy repo pointed at this same instance is unaffected.

BEGIN;

CREATE TABLE public.alerts (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  -- Discriminator for the `condition` payload. The four families need genuinely
  -- different fields, so the shape is validated in TypeScript (parseCondition in
  -- src/lib/alerts/types.ts) on every write path rather than by a CHECK nobody
  -- can read. That also means a new alert family costs zero migrations.
  alert_type        text NOT NULL CHECK (alert_type IN ('holding', 'balance', 'performance', 'activity')),
  condition         jsonb NOT NULL CHECK (jsonb_typeof(condition) = 'object'),
  scope_mode        text NOT NULL DEFAULT 'account' CHECK (scope_mode IN ('account', 'household', 'book')),
  account_number    text,
  household_id      text,
  household_name    text,                    -- denormalized: renders without a join, survives reseed
  frequency         text NOT NULL DEFAULT 'realtime' CHECK (frequency IN ('realtime', 'daily', 'weekly')),
  severity          text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled           boolean NOT NULL DEFAULT true,
  -- A third state, distinct from `enabled`. Paused (enabled=false) stays in the
  -- working list because the user expects to flip it back soon; archived drops
  -- out of it entirely and is never evaluated, but is kept so it can be restored
  -- rather than recreated from scratch.
  archived          boolean NOT NULL DEFAULT false,
  -- How long a given fingerprint stays suppressed after firing, so a condition
  -- that stays true does not re-fire on every sweep.
  cooldown_hours    integer NOT NULL DEFAULT 24 CHECK (cooldown_hours >= 0),
  notify_in_app     boolean NOT NULL DEFAULT true,
  notify_email      boolean NOT NULL DEFAULT false,
  -- Stamped on every sweep whether or not the rule fired — powers the
  -- "last checked 3m ago" line the user reads to trust the system.
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  -- Why a rule isn't firing (orphaned scope after a reseed, malformed condition).
  -- Rendered as a red pill in the rules table; silence is the worst failure mode.
  last_error        text,
  trigger_count     integer NOT NULL DEFAULT 0,
  source            text NOT NULL DEFAULT 'builder' CHECK (source IN ('builder', 'chat')),
  created_by        text NOT NULL,
  created_by_name   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Scope and its columns must agree, or the evaluator would silently widen an
  -- account-scoped alert to the whole book.
  CONSTRAINT alerts_scope_shape CHECK (
    (scope_mode = 'account'   AND account_number IS NOT NULL) OR
    (scope_mode = 'household' AND household_id   IS NOT NULL) OR
    (scope_mode = 'book')
  )
);

-- The cron sweep's driving query: live rules, by frequency, oldest check first.
CREATE INDEX alerts_due_idx     ON public.alerts (archived, enabled, frequency, last_evaluated_at);
CREATE INDEX alerts_account_idx ON public.alerts (account_number);

CREATE TABLE public.alert_events (
  id              text PRIMARY KEY,
  alert_id        text NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  -- Snapshot of the rule at fire time. Editing or deleting a rule must not
  -- rewrite history in the feed.
  alert_name      text,
  alert_type      text,
  -- Stable identity of "this specific thing being wrong" (rule + subject +
  -- threshold) — never derived from the observed value, or every price tick would
  -- mint a new fingerprint. Cooldown applies per fingerprint, not per rule, so a
  -- book-wide rule can fire for account A without muting account B.
  fingerprint     text NOT NULL,
  title           text NOT NULL,
  detail          text,
  account_number  text,
  account_name    text,
  household_name  text,
  -- Security-level alerts roll up: a book-wide "AAPL below $180" writes ONE event
  -- with symbol='AAPL' and affected_count = holders, not one row per account.
  symbol          text,
  affected_count  integer NOT NULL DEFAULT 1,
  observed_value  numeric(18,6),
  threshold_value numeric(18,6),
  -- {metric, op, threshold, asOf, ...} for the expanded row.
  observed        jsonb,
  severity        text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged')),
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by text
);

-- Feed ordering + the unread badge count.
CREATE INDEX alert_events_feed_idx   ON public.alert_events (status, triggered_at DESC);
-- The cooldown lookup: newest event for (alert, fingerprint).
CREATE INDEX alert_events_dedupe_idx ON public.alert_events (alert_id, fingerprint, triggered_at DESC);

-- Race-condition floor for dedupe: at most ONE unacknowledged event per
-- (rule, fingerprint). The evaluator also pre-filters in memory; this index is
-- what makes two concurrent cron runs safe. Once acknowledged the row leaves
-- 'new', the index releases, and cooldown_hours governs the re-fire.
CREATE UNIQUE INDEX alert_events_open_dedupe_idx
  ON public.alert_events (alert_id, fingerprint) WHERE status = 'new';

-- The app talks to the DB with the anon key end-to-end; API routes (session cookie)
-- are the auth gate. Permissive RLS keeps parity with the rest of the schema while
-- still satisfying realtime's SELECT check. Same posture as 0002_case_workspace.sql.
ALTER TABLE public.alerts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY alerts_all       ON public.alerts       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY alert_events_all ON public.alert_events FOR ALL USING (true) WITH CHECK (true);

-- Live updates: the Alert Center's rules table and activity feed, and the
-- sidebar's unread badge.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.alerts,
  public.alert_events;

COMMIT;

-- Verify after applying:
--   select count(*) from public.alerts;         -- 0, not an error
--   select count(*) from public.alert_events;   -- 0, not an error
--   select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'alert%';
