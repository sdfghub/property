# Property — HOA / condo expense management

Management app for Romanian associations of proprietors: enter the month's invoices and
meter readings, split every expense across units by the association's declared rules
(consumption, m², residents, equal…), age penalties per Law 196/2018, track payments, and
publish the **avizier** — the per-owner grid owners actually read.

NestJS + Prisma + Postgres API, Vite + React admin/owner SPA, an Expo mobile client, and a
Docker Compose production deploy. Live for one real association at **vicusia.ro**.

> ⚠️ **The repo root is the backend project**; the web client lives in `frontend/`.
> All commands below run from here.

## Quickstart

```bash
docker compose up -d                                        # Postgres 16 on :5540
npm ci && (cd frontend && npm ci)                           # two SEPARATE npm trees
cp .env.example .env
echo 'VITE_API_BASE=http://localhost:3100/api' > frontend/.env.local
npx prisma db push                                          # no migrations in this project
npm run seed                                                # root admin (see local-dev.md)
bash scripts/start-dev.sh                                   # API :3100 + SPA :5173
```

Open <http://localhost:5173>. Then load a real association locally:

```bash
bash scripts/rebuild-kralik-nobridge.sh    # full history 2021-11 → 2026-05
```

**New here? Read [docs/onboarding.md](./docs/onboarding.md) first** — it covers the same
steps plus the project rules that aren't guessable from the code.

## Layout

| Path | What |
|------|------|
| `src/modules/` | API feature modules (billing, period, finance, corrections, funds, auth…) |
| `src/scripts/` | ops/one-off scripts, run via `ts-node` (there is no jest suite) |
| `prisma/` | `schema.prisma` + `seed.ts` — schema is applied with `db push`, **not** migrations |
| `frontend/` | Vite + React SPA (own `package.json`/lockfile) |
| `mobile/` | Expo client (secondary) |
| `data/<COMM>/` | committed per-community source data (`def.json`, actuals, history) |
| `deploy/` | production Docker Compose + Caddy |
| `scripts/` | `start-dev.sh`, community reseeds, DB snapshots |
| `infra/` | legacy AWS CDK — not used to run anything today |

## Docs

| Doc | Covers |
|-----|--------|
| [onboarding.md](./docs/onboarding.md) | day one: setup, real data, project rules, what "green" means |
| [local-dev.md](./docs/local-dev.md) | ports, env vars, per-service commands, gotchas |
| [architecture.md](./docs/architecture.md) | the domain model: periods, funds, allocation, statements/ledger, penalties, avizier |
| [meters.md](./docs/meters.md) | meters → readings → measures, the aggregation rule, never-fall-back allocation |
| [corrections.md](./docs/corrections.md) | reshuffles/transfers/write-offs as declarations with a derived ledger |
| [frontend-conventions.md](./docs/frontend-conventions.md) | no hardcoded domain labels; EN/RO i18n contract |
| [data-reseed.md](./docs/data-reseed.md) | wiping and rebuilding a community from committed source |
| [deployment.md](./docs/deployment.md) | shipping to prod (vicusia.ro) |
| [kralik.md](./docs/kralik.md) | the live association's specifics and data caveats |
| [reports/collection-rate.md](./docs/reports/collection-rate.md) | the "grad de colectare" report |

## Caveats

- `npm run dev:db` and `prestart` are **stale** migration-based scripts — ignore them; this
  project uses `prisma db push`. `npm run allocate` is also dead (its `src/cli/allocate.ts`
  no longer exists); allocation runs as part of `prepare`.
- `npm run build` currently fails on 23 pre-existing type errors; dev and the prod image
  both transpile without typechecking. See [onboarding.md §6](./docs/onboarding.md).
- `data/Kralik/` is **real** association data (owner names, charges, debts). Private repo,
  keep it that way.
