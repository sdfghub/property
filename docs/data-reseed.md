# Wiping & reseeding a community

How to flush one community's data and rebuild it from its committed source under
`data/<COMM>/`. Other communities and all user accounts are left untouched.

> These scripts talk to whatever `DATABASE_URL` points at. Locally that's the Docker
> Postgres on :5540 (see [local-dev.md](./local-dev.md)). The backend does **not** need
> to be running for the direct (ts-node) flows below; it **does** for the API flow
> (`rebuild-api.sh`).

## Wiping

```bash
npm run wipe:community -- <COMM> --all
```

`wipe:community` deletes only that community's data (units, billing entities, groups,
periods, measures, ledgers, templates) inside one transaction. Flags:

- default: **keeps** vendor invoices and vendors (real financial records)
- `--drop-invoices` / `--drop-vendors`
- `--all` = `--drop-invoices --drop-vendors` (full flush)

`<COMM>` is the community id/code — for Kralik it is literally `Kralik` (from
`data/Kralik/def.json` → `"id": "Kralik"`).

## Kralik — the current April/May baseline

This is the flow the app is operated from today: April 2026-04 is injected at ledger
level (real opening balances from `data/Kralik/ledger-2026-04.json`), then May 2026-05 is
computed on top, with vendor penalty buckets and the apa-dif water split. Run each step
from the backend root:

```bash
# 1) flush
npm run wipe:community -- Kralik --all

# 2) import structure (community + funds + bill/meter templates)
npm run import:community      -- ./data/Kralik
npm run import:funds          -- ./data/Kralik/funds.json Kralik
npm run import:bill-templates -- ./data/Kralik
npm run import:meter-templates -- ./data/Kralik

# 3) inject April + compute May (penalty buckets, afisare-window accrual, apa-dif)
npx ts-node --transpile-only src/scripts/seed-kralik-april-may.ts

# 4) import the cash book (bank/casă → CashTx + owner receipts → Payments)
npm run import:cash
```

### Expected output

Step 3 prints the authoritative totals:

```
injected April: 149 (BE,fund) statements; Σ dueEnd (=May opening) = 679536.33
  seeded 37 penalty buckets across 2 units
  ✅ 2026-05 prepared + approved (chained from injected April)
May statement totals: opening=679536.33 charges=117436.67 payments=0 → DEBT(dueEnd)=796973
```

Step 4 prints `cash imported: 112 cash_tx, 37 payments (cycle 2026-04)`.

### Verify in the DB

```bash
PGPASSWORD=postgres psql -h localhost -p 5540 -U postgres -d property_expenses -t -A -F' | ' \
  -c "select p.code, p.status, count(distinct s.billing_entity_id) bes, round(sum(s.due_end)::numeric,2) debt
      from period p left join be_statement s on s.period_id=p.id
      join community c on c.id=p.community_id
      where c.id='Kralik' group by p.code,p.status order by p.code;"
```

Expected: `2026-04 | CLOSED | 27 | 679536.33` and `2026-05 | CLOSED | 27 | 796973.00`.
May is left **approved (CLOSED)**; reopen it from the UI (or the home-screen CTA) to keep
operating it.

## Kralik — the full historical flow (`rebuild-kralik.sh`)

An alternative recipe that loads the **entire** historical ledger (Feb-2022 .. Feb-2026)
straight from the exported history via the migration injector, then computes 2026-03 on
top as the live open period. Use this when you want the full pre-cutover history rather
than the April/May slice.

```bash
bash scripts/rebuild-kralik.sh
```

It runs: wipe → import community/funds/templates → `npm run history:inject -- ./data/Kralik`
(creates the pre-cutover CLOSED periods with per-unit charges, balance chain and penalty
buckets) → `seed-kralik-close.ts` (computes 2026-03).

## Any community, through the API (`rebuild-api.sh`)

Rebuilds an association **over HTTP** against a running backend — flush, import, then
submit each period's actuals and close→prepare→approve via the API. Used for the PENTEST
fixture and cross-tenant testing.

```bash
# backend must already be running (npm run dev)
API_EMAIL=bogdan.boji@gmail.com API_PASSWORD=123456 \
  bash scripts/rebuild-api.sh ./data/PENTEST
```

`BASE_URL` defaults to `http://localhost:3100`; `API_EMAIL`/`API_PASSWORD` must be a
system-admin login (seed one with `npm run seed`).

## Related scripts

| Command | Purpose |
|---------|---------|
| `npm run wipe:community -- <COMM> [--all]` | Delete one community's data. |
| `npm run import:community -- ./data/<COMM>` | Import topology + expense config from `def.json`. |
| `npm run import:funds -- ./data/<COMM>/funds.json <COMM>` | Import fund definitions. |
| `npm run import:bill-templates -- ./data/<COMM>` | Import bill entry templates. |
| `npm run import:meter-templates -- ./data/<COMM>` | Import meter entry templates. |
| `npm run import:cash` | Import the Kralik cash book (`data/Kralik/cash-2026-05.json`). |
| `npm run history:inject -- ./data/<COMM>` | Inject full pre-cutover history at ledger level. |
| `npm run db:flush` | Flush the **entire** DB (all communities) — destructive. |
