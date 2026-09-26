-- 0006_fidelity_account_format.sql
-- What: reformats all 300 FIDELITY account numbers from `Z########` to `7N-NNNNNN`
--       (two digits starting with 7, a dash, then six digits — e.g. 77-123456),
--       and rewrites every dependent text reference in the same transaction.
-- Why:  the Fidelity format was wrong. Schwab (`NNNN-NNNN`) and Pershing
--       (`ABC/XYZ######`) are correct and are NOT touched by this migration.
--
-- Apply in the Supabase SQL editor. Single transaction.
--
-- SCOPE: formatting only. No account is added, removed, re-assigned, or
-- re-custodied — the row count stays at exactly 300 Fidelity / 900 total.
--
-- WHY EVERY DEPENDENT NEEDS AN EXPLICIT UPDATE: `Account."accountNumber"` has NO
-- foreign key pointing at it anywhere in the schema. Every other table that
-- records an account number does so as a loose text copy, so nothing cascades.
-- The counts below were measured against the live DB before writing this file:
--
--     Account."accountNumber"            300  (the source)
--     "Ticket"."accountNumber"             4
--     "Ticket".description                 4  (number embedded in prose)
--     "TicketMessage".body                 4  (prose)
--     "TicketActivity".note                4  (prose)
--     transfers.from_account_number        4
--     transfers.to_account_number          3
--     sales_credits.account_number         1
--     alerts / alert_events / saved_reports / cases / activity_log /
--     ticket_drafts                        0  (updated anyway, see below)
--
-- The zero-row tables are still updated. They are no-ops today, but a user could
-- create a Fidelity-scoped alert or report between now and whenever this is run,
-- and a scope silently pointing at a dead number is exactly the failure this
-- migration exists to prevent.
--
-- NO VIEW DDL IS NEEDED. The six views exposing account_number
-- (portfolio_accounts, cash_accounts, commissions, transactions_view,
-- retirement_contributions_view, retirement_rmd_view) all derive it from
-- "Account", so they follow automatically. The view-dependency-chain rule in
-- README.md is therefore not triggered — this migration alters no view.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Mapping table. Kept permanently: it is both the audit trail and the
--    rollback path (see the commented block at the end of this file).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fidelity_account_renumber (
  account_id    text PRIMARY KEY,
  old_number    text NOT NULL,
  new_number    text NOT NULL UNIQUE,
  renumbered_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Build the mapping.
--
--    Deterministic rather than random, so this migration is reproducible and
--    reviewable — you can read the SQL and know exactly what every account will
--    become, and re-running against the same rows yields the same result.
--
--    Uniqueness is guaranteed BY CONSTRUCTION, not by a retry loop:
--    7919 is prime (so coprime to 10^6), which makes
--        rn -> (rn * 7919 + 100003) mod 10^6
--    injective over rn = 1..10^6. With only 300 rows every six-digit tail is
--    therefore distinct, and the whole string is distinct regardless of what the
--    second digit does. The UNIQUE constraint on new_number is a belt-and-braces
--    assert that this reasoning holds, not the mechanism that enforces it.
--
--    The tail is then digit-REVERSED. reverse() on a fixed-width 6-character
--    string is itself a bijection, so uniqueness survives untouched — but it
--    destroys the visible arithmetic. Without it the generated numbers come out
--    as 70-107922, 71-115841, 72-123760 ... an obvious +7919 progression that
--    reads as machine-generated the moment anyone scans the account list.
--
--    ORDER BY md5(id) scatters the assignment so accounts that happen to sit next
--    to each other don't receive consecutive numbers.
--
--    The second digit cycles 0-9, giving the 70-xxxxxx .. 79-xxxxxx spread of a
--    real custodian range. Every number still starts with 7.
--
--    No collision risk with the other custodians: Schwab puts its dash at index 4
--    (NNNN-NNNN), this format puts it at index 2 (NN-NNNNNN), and Pershing is
--    alpha-prefixed. (The unique index is on ("accountNumber", "custodialPlatform")
--    anyway, so a cross-custodian match would not even be a violation.)
-- ---------------------------------------------------------------------------
INSERT INTO public.fidelity_account_renumber (account_id, old_number, new_number)
SELECT
  s.id,
  s."accountNumber",
  '7' || ((s.rn - 1) % 10)::text || '-' ||
    reverse(lpad((((s.rn * 7919) + 100003) % 1000000)::text, 6, '0'))
FROM (
  SELECT id,
         "accountNumber",
         row_number() OVER (ORDER BY md5(id)) AS rn
  FROM public."Account"
  WHERE "custodialPlatform" = 'FIDELITY'
) s
ON CONFLICT (account_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Dependent tables. All join through the mapping, which contains ONLY
--    Fidelity rows — this is what makes it structurally impossible for a Schwab
--    or Pershing number to be modified by any statement below.
-- ---------------------------------------------------------------------------

-- 3a. Scalar columns: exact match.
UPDATE public."Ticket" t
SET "accountNumber" = m.new_number
FROM public.fidelity_account_renumber m
WHERE t."accountNumber" = m.old_number;

UPDATE public.transfers tr
SET from_account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE tr.from_account_number = m.old_number;

UPDATE public.transfers tr
SET to_account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE tr.to_account_number = m.old_number;

UPDATE public.sales_credits sc
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE sc.account_number = m.old_number;

UPDATE public.cases c
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE c.account_number = m.old_number;

UPDATE public.activity_log al
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE al.account_number = m.old_number;

UPDATE public.ticket_drafts td
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE td.account_number = m.old_number;

UPDATE public.alert_events ae
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE ae.account_number = m.old_number;

UPDATE public.alerts a
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE a.account_number = m.old_number;

UPDATE public.saved_reports r
SET account_number = m.new_number
FROM public.fidelity_account_renumber m
WHERE r.account_number = m.old_number;

-- 3b. Array scopes. Rebuild element-wise so a mixed-custodian scope keeps its
--     Schwab and Pershing entries untouched and in position.
UPDATE public.alerts a
SET account_numbers = ARRAY(
  SELECT COALESCE(m.new_number, x)
  FROM unnest(a.account_numbers) WITH ORDINALITY AS u(x, ord)
  LEFT JOIN public.fidelity_account_renumber m ON m.old_number = u.x
  ORDER BY u.ord
)
WHERE a.account_numbers && ARRAY(SELECT old_number FROM public.fidelity_account_renumber);

UPDATE public.saved_reports r
SET account_numbers = ARRAY(
  SELECT COALESCE(m.new_number, x)
  FROM unnest(r.account_numbers) WITH ORDINALITY AS u(x, ord)
  LEFT JOIN public.fidelity_account_renumber m ON m.old_number = u.x
  ORDER BY u.ord
)
WHERE r.account_numbers && ARRAY(SELECT old_number FROM public.fidelity_account_renumber);

-- 3c. Report params carry their own copy of the account number, set from the
--     report-registry inputs. Nothing validates it, so a stale value here is
--     invisible rather than loud — worth fixing even though it is 0 rows today.
UPDATE public.saved_reports r
SET params = jsonb_set(r.params, '{accountNumber}', to_jsonb(m.new_number))
FROM public.fidelity_account_renumber m
WHERE r.params->>'accountNumber' = m.old_number;

-- 3d. Prose. The seed writes the account number into ticket copy
--     ("Ticket opened for account Z12345678"), so a column-only update would
--     leave the body contradicting its own accountNumber field.
UPDATE public."Ticket" t
SET description = replace(t.description, m.old_number, m.new_number)
FROM public.fidelity_account_renumber m
WHERE t.description LIKE '%' || m.old_number || '%';

UPDATE public."TicketMessage" tm
SET body = replace(tm.body, m.old_number, m.new_number)
FROM public.fidelity_account_renumber m
WHERE tm.body LIKE '%' || m.old_number || '%';

UPDATE public."TicketActivity" ta
SET note = replace(ta.note, m.old_number, m.new_number)
FROM public.fidelity_account_renumber m
WHERE ta.note LIKE '%' || m.old_number || '%';

-- ---------------------------------------------------------------------------
-- 4. The source of truth, last.
-- ---------------------------------------------------------------------------
UPDATE public."Account" a
SET "accountNumber" = m.new_number,
    "updatedAt"     = now()
FROM public.fidelity_account_renumber m
WHERE a.id = m.account_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verify after applying — every assertion below must hold.
--
--   -- Fidelity fully converted: 300, then 0
--   select count(*) from "Account"
--    where "custodialPlatform"='FIDELITY' and "accountNumber" ~ '^7[0-9]-[0-9]{6}$';
--   select count(*) from "Account"
--    where "custodialPlatform"='FIDELITY' and "accountNumber" !~ '^7[0-9]-[0-9]{6}$';
--
--   -- Other custodians untouched: 300 and 300
--   select count(*) from "Account"
--    where "custodialPlatform"='SCHWAB'   and "accountNumber" ~ '^[0-9]{4}-[0-9]{4}$';
--   select count(*) from "Account"
--    where "custodialPlatform"='PERSHING' and "accountNumber" ~ '^(ABC|XYZ)[0-9]{6}$';
--
--   -- Shape intact: 900, and 0 duplicates
--   select count(*) from "Account";
--   select count(*) from (
--     select "accountNumber" from "Account" group by 1 having count(*)>1) d;
--
--   -- No surviving old-format string anywhere, including prose: all 0
--   select count(*) from "Ticket"          where "accountNumber" ~ 'Z[0-9]{8}'
--                                             or description     ~ 'Z[0-9]{8}';
--   select count(*) from "TicketMessage"   where body  ~ 'Z[0-9]{8}';
--   select count(*) from "TicketActivity"  where note  ~ 'Z[0-9]{8}';
--   select count(*) from transfers         where from_account_number ~ 'Z[0-9]{8}'
--                                             or to_account_number   ~ 'Z[0-9]{8}';
--   select count(*) from sales_credits     where account_number ~ 'Z[0-9]{8}';
--
--   -- Every dependent reference still resolves to a real account: all 0
--   select count(*) from "Ticket" t
--     left join "Account" a on a."accountNumber"=t."accountNumber" where a.id is null;
--   select count(*) from sales_credits s
--     left join "Account" a on a."accountNumber"=s.account_number where a.id is null;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK (uncomment and run as one transaction to restore the Z######## form).
-- Same statement order, swapping new_number -> old_number.
--
-- BEGIN;
--   UPDATE public."Account" a SET "accountNumber" = m.old_number, "updatedAt" = now()
--     FROM public.fidelity_account_renumber m WHERE a.id = m.account_id;
--   UPDATE public."Ticket" t SET "accountNumber" = m.old_number
--     FROM public.fidelity_account_renumber m WHERE t."accountNumber" = m.new_number;
--   UPDATE public."Ticket" t SET description = replace(t.description, m.new_number, m.old_number)
--     FROM public.fidelity_account_renumber m WHERE t.description LIKE '%'||m.new_number||'%';
--   UPDATE public."TicketMessage" tm SET body = replace(tm.body, m.new_number, m.old_number)
--     FROM public.fidelity_account_renumber m WHERE tm.body LIKE '%'||m.new_number||'%';
--   UPDATE public."TicketActivity" ta SET note = replace(ta.note, m.new_number, m.old_number)
--     FROM public.fidelity_account_renumber m WHERE ta.note LIKE '%'||m.new_number||'%';
--   UPDATE public.transfers tr SET from_account_number = m.old_number
--     FROM public.fidelity_account_renumber m WHERE tr.from_account_number = m.new_number;
--   UPDATE public.transfers tr SET to_account_number = m.old_number
--     FROM public.fidelity_account_renumber m WHERE tr.to_account_number = m.new_number;
--   UPDATE public.sales_credits sc SET account_number = m.old_number
--     FROM public.fidelity_account_renumber m WHERE sc.account_number = m.new_number;
--   -- (alerts / saved_reports / cases / activity_log / ticket_drafts / alert_events
--   --  mirror the 3a-3c statements with new_number and old_number swapped.)
-- COMMIT;
-- ---------------------------------------------------------------------------
