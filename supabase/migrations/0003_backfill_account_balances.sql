-- 0003_backfill_account_balances.sql
-- What: data backfill — populate the empty account_balances table with derived,
--       margin-realistic figures for taxable accounts (individual/joint/trust).
-- Why:  the Margin Agent (and @audit's margin section) read account_balances,
--       which no seed step ever populated. Retirement accounts are intentionally
--       skipped — "no margin data on file" is the correct answer for an IRA.
--
-- One-time backfill for the CURRENT accounts. `npm run db:seed` regenerates
-- accounts with new ids, so the same logic also lives in prisma/seed.ts
-- (seedAccountBalances) — keep the two in sync.
--
-- Deterministic pseudo-randomness comes from hashtext(account id): ~35% of
-- taxable accounts carry a margin debit, ~15% of those are in an active call.

BEGIN;

INSERT INTO account_balances (
  id, account_id, total_equity, liquidating_equity, long_market_value, short_market_value,
  cash_management_balance, credit_debit_balance, total_house_requirement, house_surplus,
  finra_surplus, total_sma, today_federal_call, foreign_ccy_house_req,
  funds_available_to_trade, funds_available_to_withdraw, day_trade_buying_power,
  funds_unavailable, funds_due, cash, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  s.id,
  round(s.eq, 2),
  round(s.eq * 0.995, 2),
  round(s.lmv, 2),
  0,
  round(s.cash, 2),
  round(CASE WHEN s.margined THEN -s.debit ELSE s.cash END, 2),
  round(s.house_req, 2),
  round(s.eq - s.house_req, 2),
  round(CASE WHEN s.margined THEN s.eq - 0.25 * s.lmv ELSE s.eq END, 2),
  round(CASE WHEN s.margined THEN s.eq * (0.05 + s.r2 * 0.20) ELSE 0 END, 2),
  round(s.fed_call, 2),
  0,
  round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 2 ELSE s.cash END, 2),
  round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 0.5 ELSE s.cash END, 2),
  round(CASE WHEN s.margined THEN GREATEST(s.eq - s.house_req, 0) * 4 ELSE 0 END, 2),
  0,
  round(s.fed_call, 2),
  round(s.cash, 2),
  now(), now()
FROM (
  SELECT b.*,
    CASE WHEN b.in_call THEN b.eq * (1.005 + b.r2 * 0.03)   -- requirement just above equity → deficit
         WHEN b.margined THEN 0.30 * b.lmv
         ELSE 0 END AS house_req,
    CASE WHEN b.in_call THEN b.eq * (0.01 + b.r2 * 0.05) ELSE 0 END AS fed_call
  FROM (
    SELECT a2.*,
      CASE WHEN a2.margined THEN a2.eq + a2.debit ELSE a2.eq - a2.cash END AS lmv
    FROM (
      SELECT a1.*,
        CASE WHEN a1.margined THEN a1.eq * (0.10 + a1.r2 * 0.45) ELSE 0 END AS debit,
        CASE WHEN a1.margined THEN 0 ELSE a1.eq * (0.02 + a1.r2 * 0.08) END AS cash,
        (a1.margined AND a1.r3 < 0.15) AS in_call
      FROM (
        SELECT a.id,
          GREATEST(COALESCE(a.balance, 0)::numeric, 10000) AS eq,
          (abs(hashtext(a.id || 'm2')) % 1000) / 1000.0 AS r2,
          (abs(hashtext(a.id || 'm3')) % 1000) / 1000.0 AS r3,
          ((abs(hashtext(a.id || 'm1')) % 1000) / 1000.0) < 0.35 AS margined
        FROM "Account" a
        WHERE lower(a."accountType"::text) IN ('individual', 'joint', 'trust')
          AND NOT EXISTS (SELECT 1 FROM account_balances ab WHERE ab.account_id = a.id)
      ) a1
    ) a2
  ) b
) s;

COMMIT;

-- Verify:
--   select count(*) filter (where credit_debit_balance < 0) as margined,
--          count(*) filter (where today_federal_call > 0) as in_call,
--          count(*) as total
--   from account_balances;
