# Supabase migrations

This app runs against a long-lived Supabase instance whose schema predates this repo.
Prisma migrate was never initialized against this DB — **never run `prisma migrate dev`
or `prisma migrate reset`**. Schema changes are plain SQL files in this directory,
applied by hand in the Supabase SQL editor, newest number last.

## Numbering

- `0001_baseline.sql` — reserved for the full schema snapshot of the shared DB
  (tables + views as they exist in the live instance). Not yet committed.
- `0002_case_workspace.sql` — case collaboration tables (`cases`, `case_messages`,
  `case_participants`, `case_documents`), permissive RLS, realtime publication,
  and the `case-documents` storage bucket + policies.
- `0003_backfill_account_balances.sql` — data-only backfill of margin figures into
  `account_balances`. The same logic is duplicated in `seedAccountBalances()`.
- `0004_alerts.sql` — `alerts` + `alert_events`.
- `0005_saved_reports.sql` — `saved_reports` + `report_runs`.
- `0006_fidelity_account_format.sql` — data-only: reformats the 300 Fidelity account
  numbers from `Z########` to `7N-NNNNNN` and rewrites every dependent text copy.
  Keeps a permanent `fidelity_account_renumber` mapping table for audit and rollback.

## Known drift from the live DB

- **`alerts.account_numbers text[]` exists in the live database but no migration in
  this directory creates it** — `0004_alerts.sql` defines only the scalar
  `account_number`. It was evidently added by hand in the SQL editor. The app writes
  it on every alert insert/patch (`src/lib/alerts/validate.ts` → `/api/alerts`), so a
  fresh environment built purely from these files would fail on the first alert write
  with `column "account_numbers" does not exist`. Fold it into `0001_baseline.sql`
  when that snapshot is finally taken.
- More broadly: with `0001_baseline.sql` still uncommitted, every view and ~20
  older tables exist only in the running instance. These files are a delta on top of
  a baseline that is not in version control.

## Rules

- Wrap each migration in `BEGIN`/`COMMIT`. Schema and data migrations stay in
  separate files.
- **View dependency chain**: the shared DB has interdependent views
  (`portfolio_accounts`, `holdings_enriched`, `transactions_view`,
  `retirement_contributions_view`, `retirement_rmd_view`, `cash_accounts`,
  `crm_contacts`, `commissions`, `account_transactions`). If a migration alters
  `Account`, `Transaction`, `Client`, `Holding`, `Household`, or `Security`, it must
  recreate every dependent view in the same file with `CREATE OR REPLACE VIEW` —
  never `DROP VIEW`.
- **Reseed-proofing**: `npm run db:seed` wipes and rebuilds the seeded tables
  (`Account`, `User`, `Client`, `Household`, …) with fresh CUIDs. Tables that must
  survive a reseed (like the case workspace tables) must not FK into seeded tables —
  store `account_number` and user ids as plain text. After a reseed, a case's
  stored `account_number` may no longer exist in `portfolio_accounts`; agents then
  answer "Account not found", which is expected.
- Migrations only run once, by hand. Anything a page needs on every reseed belongs
  in `prisma/seed.ts`, not here.
