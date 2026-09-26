-- 0005_saved_reports.sql
-- What: the Report Center — `saved_reports` (standing report definitions) and
--       `report_runs` (execution history); indexes, RLS, realtime publication.
-- Why:  saved reports lived in localStorage (composer-custom-commands), so they
--       were per-browser and invisible to teammates, and nothing could run them
--       on a schedule. This is the same shape as 0004_alerts.sql: a definition
--       table plus a feed, driven by a cron guarded with CRON_SECRET.
--
-- Apply in the Supabase SQL editor. Single transaction.
--
-- Reseed-proof: scope is plain-text account_number / household_id, never FKs to
-- seeded tables. The only FK is report_runs -> saved_reports, both owned here.
--
-- Run history deliberately stores METADATA ONLY — when it ran, how many rows, how
-- long, any error. Opening a run re-executes it against current data rather than
-- replaying a snapshot, so a report can never show numbers that were true last
-- Tuesday but are wrong today.

BEGIN;

CREATE TABLE public.saved_reports (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  -- An id from REPORT_CATALOG in src/lib/report-registry.ts. The catalog is the
  -- allowlist: it is re-checked on every write, so a hand-edited or
  -- model-authored row can never point at an intent the client couldn't run.
  report_id         text NOT NULL,
  -- User-supplied inputs only — allowlisted against the report's declared
  -- `params`, then merged over its defaultParams at run time.
  params            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  scope_mode        text NOT NULL DEFAULT 'book' CHECK (scope_mode IN ('account', 'household', 'book')),
  account_number    text,
  account_numbers   text[] NOT NULL DEFAULT '{}',
  household_id      text,
  household_name    text,
  -- 'manual' = run it yourself. The rest are picked up by the cron sweep.
  schedule          text NOT NULL DEFAULT 'manual' CHECK (schedule IN ('manual', 'daily', 'weekly', 'monthly')),
  enabled           boolean NOT NULL DEFAULT true,
  -- Same three-state model as alerts: paused stays in the working list, archived
  -- leaves it and is never scheduled, but keeps everything so it can be restored.
  archived          boolean NOT NULL DEFAULT false,
  last_run_at       timestamptz,
  last_row_count    integer,
  last_error        text,
  run_count         integer NOT NULL DEFAULT 0,
  source            text NOT NULL DEFAULT 'builder' CHECK (source IN ('builder', 'chat', 'imported')),
  created_by        text NOT NULL,
  created_by_name   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_reports_scope_shape CHECK (
    (scope_mode = 'account'   AND account_number IS NOT NULL) OR
    (scope_mode = 'household' AND household_id   IS NOT NULL) OR
    (scope_mode = 'book')
  )
);

-- The cron sweep's driving query: live scheduled reports, oldest run first.
CREATE INDEX saved_reports_due_idx     ON public.saved_reports (archived, enabled, schedule, last_run_at);
CREATE INDEX saved_reports_created_idx ON public.saved_reports (created_at DESC);

CREATE TABLE public.report_runs (
  id               text PRIMARY KEY,
  -- Nullable so an ad-hoc catalog run can be recorded without first being saved.
  saved_report_id  text REFERENCES public.saved_reports(id) ON DELETE CASCADE,
  -- Snapshot of what ran, so renaming or deleting a saved report doesn't rewrite
  -- history in the feed.
  report_id        text NOT NULL,
  label            text NOT NULL,
  row_count        integer,
  status           text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  error            text,
  duration_ms      integer,
  trigger          text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
  ran_by           text,
  ran_by_name      text,
  ran_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX report_runs_feed_idx  ON public.report_runs (ran_at DESC);
CREATE INDEX report_runs_saved_idx ON public.report_runs (saved_report_id, ran_at DESC);

-- Same posture as alerts and cases: anon key end-to-end, API routes are the auth
-- gate, permissive RLS keeps parity and satisfies realtime's SELECT check.
ALTER TABLE public.saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_runs   ENABLE ROW LEVEL SECURITY;

CREATE POLICY saved_reports_all ON public.saved_reports FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY report_runs_all   ON public.report_runs   FOR ALL USING (true) WITH CHECK (true);

-- Live updates: the Report Center's list and run feed.
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.saved_reports,
  public.report_runs;

COMMIT;

-- Verify after applying:
--   select count(*) from public.saved_reports;  -- 0, not an error
--   select count(*) from public.report_runs;    -- 0, not an error
