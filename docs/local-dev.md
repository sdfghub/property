# Local development

How to run the full stack — Postgres, the NestJS API, and the Vite/React frontend — on
your machine.

## Prerequisites

- **Node.js** (v18+) and npm
- **Docker** (for the local Postgres) — or a Postgres 16 you manage yourself
- All commands below run from the backend project root unless noted.

## Ports & endpoints

| Service | Port | Notes |
|---------|------|-------|
| Postgres | **5540** (host) → 5432 (container) | Host 5432 is used by another local project, so compose publishes 5540. |
| Backend API | **3100** | Global prefix `/api` → base URL `http://localhost:3100/api`. |
| Frontend (Vite) | **5173** | Dev server; talks to the API via `VITE_API_BASE`. |

## The short way: one command

Once the one-time setup below is done, this starts everything (Postgres, API, Vite) and
tears it all down on Ctrl+C:

```bash
bash scripts/start-dev.sh          # add --no-db if you run your own Postgres
```

⚠️ The repo root **is** the backend project; `frontend/` is a separate npm project inside it
with its own lockfile. Install in both (`npm ci` each) and never symlink one tree into the
other.

## 1. Database

The local Postgres runs in Docker:

```bash
docker compose up -d          # starts container `property-db` on localhost:5540
```

Credentials (from `docker-compose.yml`): user `postgres`, password `postgres`,
database `property_expenses`.

## 2. Backend API

```bash
cp .env.example .env          # values already point at :5540 / :3100
npm install
npm run generate              # prisma generate (regenerate the client)
npx prisma db push            # sync the schema to the DB — there is NO migrations folder
npm run seed                  # create the root admin (see below)
npm run dev                   # ts-node-dev --respawn on :3100  → http://localhost:3100/api
```

- **Schema changes**: this project uses `prisma db push`, not migrations (there is no
  `prisma/migrations/` folder). After editing `prisma/schema.prisma`, run
  `npx prisma db push --skip-generate && npm run generate`. ⚠️ Ignore the `migrate`-based
  npm scripts (`dev:db`, `prestart`) — they're stale and would try to create a migration.
- **Hot reload**: `npm run dev` watches `src/`. A `touch src/app.ts` forces a restart.
- **Health check**: `curl http://localhost:3100/api/healthz`.

### Seed admin

`npm run seed` upserts a system-admin user. Defaults (override with `ROOT_EMAIL` /
`ROOT_PASSWORD`):

```
email:    bogdan.boji@gmail.com
password: 123456
```

## 3. Frontend

```bash
cd frontend
npm install
# Point the frontend at the local backend (this file is git-ignored):
echo 'VITE_API_BASE=http://localhost:3100/api' > .env.local
npm run dev                   # vite on http://localhost:5173
```

The API client (`frontend/src/api/client.ts`) reads `VITE_API_BASE` (or
`VITE_API_BASE_URL`); without it, it falls back to same-origin `/api`, which will NOT
reach the backend on :3100 — so `.env.local` is required for local dev. Push
notifications additionally need the `VITE_FCM_*` keys (optional for most work).

CORS on the backend already allows `http://localhost:5173` (see `APP_ORIGIN` in `.env`).

## Environment variables (backend `.env`)

`.env.example` covers everything you need locally; the rest have working dev defaults and
only matter in prod.

| Var | Local value | Purpose |
|-----|-------------|---------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5540/property_expenses?schema=public` | Prisma connection. |
| `PORT` | `3100` | API listen port. |
| `NODE_ENV` | `development` | |
| `APP_ORIGIN` | `http://localhost:5173,http://localhost:8081` | Allowed CORS origins (web + Expo). Also read as `CORS_ORIGINS` / `FRONTEND_ORIGIN`. |
| `JWT_ACCESS_SECRET` | *(unset → `dev_access_secret`)* | Access-token signing. **Must be set in prod** (`openssl rand -hex 32`). |
| `JWT_REFRESH_SECRET` | *(unset → `dev_refresh_secret`)* | Refresh-token signing. Same. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900s` / default | Token lifetimes. |
| `APP_PUBLIC_URL` / `APP_PUBLIC_BASE_URL` | *(unset)* | Base URL used in invite/notification links. |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | *(unset)* | Outbound email (invites, notifications). ⚠️ Without these, invite emails **silently don't send** locally — grab the link from the API response/logs instead. |
| `RESEND_API_KEY` | *(unset)* | Alternative mail transport. |
| `FCM_SERVICE_ACCOUNT_JSON` / `FCM_SERVICE_ACCOUNT_PATH` | *(unset)* | Push notifications (backend side); optional. |
| `ROOT_EMAIL` / `ROOT_PASSWORD` | see below | Seed admin credentials. |

Frontend (`frontend/.env.local`): `VITE_API_BASE` (required, see §3) and the optional
`VITE_FCM_*` keys for web push.

Reseed/importer switches, used only by the scripts in [data-reseed.md](./data-reseed.md):
`HISTORY_CUTOVER`, `KRALIK_SKIP_APRIL`, `KRALIK_SOURCE_PENALTIES`, `WIPE`, `COMM`.

## Common tasks

```bash
npm run dev                       # run the API with hot reload
npm run typecheck                 # tsc --noEmit (23 pre-existing errors — see onboarding.md §6)
npx prisma studio                 # browse the DB in a UI
npm run seed                      # (re)create the root admin
npm run wipe:community -- <id> --all   # wipe one community's data (see data-reseed.md)
npm run reopen:period  -- Kralik 2026-05   # real PeriodService.reopen (not a status flip)
npm run prepare:period -- Kralik 2026-05   # recompute allocation + statements → avizier
(cd frontend && npm run check:i18n)        # EN/RO parity gate
```

To rebuild a community's data from its committed source, see
[data-reseed.md](./data-reseed.md).

## Gotchas

- **`ts-node-dev` serving stale code.** If a change seems to have no effect (a script or
  service behaving like the old version), force a restart: `touch src/app.ts`. This has cost
  real debugging time — suspect it early.
- **The API runs `prisma db push` on boot**, so starting the API can migrate your DB
  schema-wise. Expected; it's the project's schema workflow.
- **Reopening/preparing a period is a service operation**, not a status update — use the UI
  or the scripts above, never a manual `UPDATE period SET status=…`.
- **Missing meter readings block the period on purpose**: allocation throws instead of
  splitting equally. See [meters.md](./meters.md).
