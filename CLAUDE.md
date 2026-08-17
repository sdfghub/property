# CLAUDE.md

HOA/condo expense-management app for Romanian associations. **This repo root is the backend
project** (NestJS + Prisma + Postgres); the web SPA is `frontend/` (Vite + React), the Expo
client is `mobile/`, prod deploy is `deploy/`, per-community source data is `data/<COMM>/`.

Full docs in [`docs/`](./docs/README.md) — start at [`docs/onboarding.md`](./docs/onboarding.md).
This file is only the rules that are easy to get wrong.

## Environment

- Postgres **:5540** (docker compose), API **:3100** (global prefix `/api`), Vite **:5173**.
- `bash scripts/start-dev.sh` runs the whole stack. API only: `npm run dev`.
- ⚠️ Two **separate** npm trees: `./` and `./frontend/`, each with its own lockfile — not
  workspaces. `npm ci` in both; never symlink or hoist one into the other.

## Hard rules

1. **Schema: `npx prisma db push`, never `prisma migrate`.** There is no migrations folder;
   the API applies `db push` on boot. After schema edits:
   `npx prisma db push --skip-generate && npm run generate`.
   The `dev:db` and `prestart` npm scripts are stale migration leftovers — never run them.
2. **No jest suite.** Checks are `npm run typecheck`, `cd frontend && npm run check:i18n`, and
   scripts under `src/scripts/*.ts` run via `ts-node --transpile-only` (add npm aliases in the
   same style as `reopen:period`, `prepare:period`).
3. **Type-error baselines: backend 23, frontend 70** (pre-existing). `npm run build` fails
   because of them; dev and the prod image transpile without typechecking. Don't chase these,
   and don't add to them.
4. **Frontend must not hardcode domain knowledge.** Codes/labels come from the backend —
   `GET /metadata` via `useMetadata()`, or the endpoint's own payload. No local code→label maps.
5. **Every UI string through i18n, in both languages.** `frontend/src/i18n/lang.ts` holds flat
   `en` + `ro` maps at parity; `t(key, varsOrFallback)`. A missing key renders as the raw key.
   `npm run check:i18n` must pass.
6. **Corrections are declarations; ledger legs are derived.** Create `Correction` rows and let
   `PeriodService.applyCorrections` derive `refType='CORRECTION'` legs. Never hand-write ledger
   entries. Reading corrections out of the ledger is a debug view only.
7. **Allocations never fall back.** A metered allocation with a missing `PeriodMeasure` throws
   and blocks prepare/close — do not reinstate an equal-split fallback.
8. **Never edit statements or period status directly.** `BeStatement`/`CommunityStatement` are
   recomputed every prepare/approve; change the ledger and recompute. Reopen/prepare through
   `PeriodService` (`npm run reopen:period -- <COMM> <YYYY-MM>`), never `UPDATE period SET status`.
9. **Audit charges via `community_charge` → `community_charge_line`** (equal to `be_statement`
   to the cent). `be_ledger_entry_detail` ALLOC legs mislabel `expenseType` and produce false
   conclusions — see `docs/architecture.md#auditing-charges`.
10. **Money is `Decimal(18,4)`**; round only at the presentation edge and keep
    `dueEnd = dueStart + charges − payments + adjustments` intact.

## Data & prod

- `data/Kralik/` is a **real, live association** (owner names, charges, debts). Private repo;
  don't copy data out. `data/DUMMY` and `data/PENTEST` are synthetic fixtures.
- Local rebuild: `bash scripts/rebuild-kralik-nobridge.sh` (see `docs/data-reseed.md`; steps 6–8
  exist because `wipe:community` can't reach `Correction`, `Meter`, `MeterReading`).
- Prod is vicusia.ro, deployed with `deploy/push-to-wend.sh`. Any script run on the host needs
  the tsconfig + legacy-decorator one-off container recipe in `docs/deployment.md`, or it dies at
  `__esDecorate`. Prod reseeds/period reopens touch real money — verify afterwards.

## Git

Work on `master` (the only long-lived branch, and what prod deploys from). Conventional-Commit
subjects (`feat(meters): …`, `fix(allocation): …`, `docs: …`). Never commit `node_modules/`,
`dist/`, logs, `.env*`, or DB dumps.
