# Onboarding — day one

Read this top to bottom once. It gets you from `git clone` to a running app with real data,
and tells you the handful of project rules that aren't guessable from the code.

## 0. What the app is

A management app for Romanian HOAs / condo associations ("asociații de proprietari"). An
admin enters the month's invoices and meter readings; the app splits every expense across
units by the rules the association declared (by consumption, by m², by residents, equal…),
ages penalties per Law 196/2018, tracks payments, and publishes the **avizier** — the
per-owner grid owners see. Currently operating one real association (Kralik) at
**vicusia.ro**, plus test fixtures.

Backend: NestJS + Prisma + Postgres. Frontend: Vite + React SPA. There's also an Expo
mobile client (secondary) and a legacy AWS/CDK path (unused).

## 1. Repo layout

⚠️ **The repo root *is* the backend project.** The web client lives inside it.

```
.                     NestJS API (package.json, prisma/, src/)
├── src/modules/       feature modules (billing, period, finance, corrections, …)
├── src/scripts/       one-off/ops scripts, run with ts-node
├── prisma/            schema.prisma + seed.ts   (NO migrations folder — see §5)
├── frontend/          Vite + React SPA — its OWN package.json + lockfile
├── mobile/            Expo app (secondary; out of scope for onboarding)
├── data/<COMM>/       committed source data per community (def.json, actuals, history)
├── deploy/            production Docker Compose + Caddy (see deployment.md)
├── scripts/           shell helpers: start-dev, reseeds, snapshots
├── infra/             legacy AWS CDK — not used to run anything today
└── docs/              you are here
```

## 2. Get it running

Prereqs: Node 18+ (20 recommended), npm, Docker (for Postgres), `psql` handy but optional.

```bash
git clone https://github.com/sdfghub/property.git
cd property/backend            # the repo root is the backend project

docker compose up -d           # Postgres 16 → localhost:5540 (container property-db)

npm ci                         # backend deps
(cd frontend && npm ci)        # frontend deps — SEPARATE tree, see the warning below

cp .env.example .env           # already points at :5540 / :3100
echo 'VITE_API_BASE=http://localhost:3100/api' > frontend/.env.local

npx prisma db push             # create the schema (no migrations in this project)
npm run seed                   # root admin: bogdan.boji@gmail.com / 123456
                               # override with ROOT_EMAIL / ROOT_PASSWORD

bash scripts/start-dev.sh      # DB + API (:3100) + Vite (:5173); Ctrl+C stops all
```

Then open <http://localhost:5173> and log in with the seeded admin.
Health check: `curl http://localhost:3100/api/healthz`.

`scripts/start-dev.sh --no-db` skips Docker if you run your own Postgres. Ports, the full
env-var table, and per-service commands are in [local-dev.md](./local-dev.md).

> ⚠️ **Two separate npm trees.** `./` and `./frontend/` each have their own
> `package.json` + lockfile — they are **not** npm workspaces. Run `npm ci` in both, and
> never symlink or hoist one into the other. A merge once committed self-referential
> `node_modules` symlinks, which destroyed both installs while `tsc` still cheerfully
> reported success. That's why `node_modules` is ignored and must stay ignored.

## 3. Get real data

An empty DB tells you nothing — the interesting behaviour (penalties, water split,
corrections, history) only shows up with a real association. Rebuild Kralik locally:

```bash
bash scripts/rebuild-kralik-nobridge.sh     # ~ a few minutes
```

That imports the community, injects the ledger history **2021-11 → 2026-04** from the
committed export, computes **2026-05** with the real close engine, imports the cash book,
registers declared corrections, and rebuilds the raw meter-reading layer. Expected end
state and how to verify it: [data-reseed.md](./data-reseed.md).

> 🔒 **This is real data.** `data/Kralik/` and your local DB contain the names, charges,
> and debts of real owners in a live association. The repo is private and stays private;
> don't paste exports, screenshots, or DB dumps anywhere outside the team.

`data/DUMMY/` is a small synthetic community if you want a throwaway fixture, and
`data/PENTEST/` is used for cross-tenant/authorization testing via `scripts/rebuild-api.sh`.

## 4. Where things live

| I want to change… | Backend | Doc |
|---|---|---|
| how an expense is split across units | `src/modules/billing/allocation.service.ts` | [architecture.md](./architecture.md) |
| the monthly cycle (prepare / approve / reopen) | `src/modules/period/period.service.ts` | [architecture.md](./architecture.md) |
| statements, ledger, the money identity | `src/modules/period/period.service.ts` (`computeStatements`) | [architecture.md](./architecture.md) |
| penalties & aging | `src/modules/period/` + `data/<COMM>/def.json` | [kralik.md](./kralik.md) |
| payments and how they're allocated to charges | `src/modules/billing/`, `payment-allocation` | [architecture.md](./architecture.md) |
| meter readings / measures | `src/modules/billing/template.service.ts` | [meters.md](./meters.md) |
| reshuffles, credit transfers, write-offs | `src/modules/corrections/` | [corrections.md](./corrections.md) |
| the avizier grid | `src/modules/finance/` + `frontend/src/components/community-admin/AvizierPanel.tsx` | [architecture.md](./architecture.md) |
| funds & fund ledger | `src/modules/fund/` | [architecture.md](./architecture.md) |
| auth, roles, invites | `src/modules/auth/`, `src/modules/invite/` | — |
| codes/labels shown in the UI | `src/common/enums-meta.ts` → `GET /metadata` | [frontend-conventions.md](./frontend-conventions.md) |
| UI strings (EN/RO) | `frontend/src/i18n/lang.ts` | [frontend-conventions.md](./frontend-conventions.md) |
| the collection-rate report | `src/modules/reports/` | [reports/collection-rate.md](./reports/collection-rate.md) |

Community-level admin screens are all under
`frontend/src/components/community-admin/` (`CommunityAdminDashboard.tsx` is the tab host).

## 5. Project rules

- **Schema: `prisma db push`, never `migrate`.** There is no `prisma/migrations/` folder;
  the API applies `db push` on boot. After editing `prisma/schema.prisma`:
  `npx prisma db push --skip-generate && npm run generate`.
  ⚠️ Ignore the stale `dev:db` and `prestart` npm scripts — they are migration-based
  leftovers and will try to create a migration.
- **Scripts, not test suites.** There is no jest setup. Ops and checks are `ts-node
  --transpile-only src/scripts/*.ts`, exposed as npm aliases (`npm run reopen:period -- Kralik 2026-05`,
  `npm run prepare:period -- …`, `npm run backfill:corrections -- Kralik`, …). Add new ones
  the same way.
- **No hardcoded domain knowledge in the frontend.** Codes and labels come from the backend
  metadata registry via `useMetadata()`. See [frontend-conventions.md](./frontend-conventions.md).
- **Every UI string goes through i18n, in both languages.** `frontend/src/i18n/lang.ts`
  holds flat `en` and `ro` maps that must stay at parity; `npm run check:i18n` (in
  `frontend/`) fails the build if a used key is missing from either.
- **Corrections are declarations; the ledger is derived.** Never write ledger legs by hand.
  See [corrections.md](./corrections.md).
- **Allocations never fall back.** A missing metered reading throws and blocks the period
  instead of silently splitting equally. See [meters.md](./meters.md).
- **Money is `Decimal(18,4)`** in Prisma; round only at the presentation edge, and keep the
  identity `dueEnd = dueStart + charges − payments + adjustments` intact.

## 6. What "green" means here

Be honest with yourself about the baseline — the repo is **not** at zero type errors:

```bash
npm run typecheck                 # backend  → 23 pre-existing errors
cd frontend && npm run typecheck  # frontend → 70 pre-existing errors
cd frontend && npm run check:i18n # must pass (exit 0)

# API smoke test — needs a running backend, an admin login, and the LOTUS-TM fixture
# (BASE_URL defaults to :3000, which is NOT this project's port):
BASE_URL=http://localhost:3100 API_EMAIL=… API_PASSWORD=… npm run api:smoke
```

Consequences worth knowing:

- `npm run build` (backend `tsc -p .`) **fails** because of those 23 errors. That's why
  `deploy/Dockerfile` runs `npm run build || true` and dev runs `ts-node-dev
  --transpile-only`. Don't "fix the build" by silencing the app.
- `vite build` succeeds regardless, because Vite does not typecheck.
- The bar for a change: **don't increase those counts**, keep `check:i18n` passing, and
  verify the actual behaviour in the UI or via the API.

## 7. Git conventions

- Work on **`master`**; it is the only long-lived branch and what prod deploys from. Short
  feature branches are fine if you're collaborating on one, but don't leave them hanging.
- Commit subjects follow what's already in `git log`: `feat(meters): …`, `fix(allocation): …`,
  `chore(scripts): …`, `docs: …`.
- Never commit `node_modules/`, `dist/`, logs, `.env*`, or DB dumps. If `git status` shows
  something big and generated, it's a `.gitignore` bug — fix the ignore, don't commit it.
- Deploying is a separate, deliberate act — see [deployment.md](./deployment.md). Prod is a
  live association's real money; reseeds and period reopens on prod get double-checked.

## 8. Handy commands

```bash
bash scripts/start-dev.sh                     # whole stack
npm run dev                                   # API only (hot reload; touch src/app.ts to force)
(cd frontend && npm run dev)                  # SPA only
npx prisma studio                             # browse the DB
npm run seed                                  # (re)create the root admin
npm run reset:user-password -- --email a@b.c --password NEW   # unstick a login
npm run wipe:community -- <COMM> --all        # destroy one community's data
npm run reopen:period -- Kralik 2026-05       # reopen a period (real service, not a status flip)
npm run prepare:period -- Kralik 2026-05      # recompute allocation + statements → avizier
```
