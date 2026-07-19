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

- **Schema changes**: this project uses `prisma db push`, not migrations. After editing
  `prisma/schema.prisma`, run `npx prisma db push --skip-generate && npm run generate`.
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

| Var | Local value | Purpose |
|-----|-------------|---------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5540/property_expenses?schema=public` | Prisma connection. |
| `PORT` | `3100` | API listen port. |
| `NODE_ENV` | `development` | |
| `APP_ORIGIN` | `http://localhost:5173,http://localhost:8081` | Allowed CORS origins (web + Expo). |

## Common tasks

```bash
npm run dev                       # run the API with hot reload
npx prisma studio                 # browse the DB in a UI
npm run seed                      # (re)create the root admin
npm run wipe:community -- <id> --all   # wipe one community's data (see data-reseed.md)
```

To rebuild a community's data from its committed source, see
[data-reseed.md](./data-reseed.md).
