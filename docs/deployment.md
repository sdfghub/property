# Deployment (prod)

The app runs on a self-hosted host (`wend`) as a Docker Compose stack, fronted by Caddy
and Cloudflare. The public site is **vicusia.ro**.

Full details live in [`deploy/README.md`](../deploy/README.md); this is the operational
summary.

## Topology

```
Browser ──HTTPS──> Cloudflare ──HTTP :80──> Caddy (web) ──> API (:3000) ──> Postgres
                   (SSL: Flexible)          deploy/Caddyfile   NestJS        db container
```

The stack is defined in [`deploy/docker-compose.yml`](../deploy/docker-compose.yml):

| Service | Image / build | Notes |
|---------|---------------|-------|
| `db` | `postgres:16` | Volume `pgdata`. Password from `DB_PASSWORD`. |
| `api` | `deploy/Dockerfile` | Runs `prisma db push --skip-generate --accept-data-loss` then `node dist/server.js` on `:3000`. |
| `web` | `deploy/web.Dockerfile` (Caddy) | Publishes `80:80` and `443:443`. `:80` is the origin Cloudflare talks to (SSL mode **Flexible**); `:443` is reserved for a future Full(strict) upgrade. |

**Schema migrations**: there is no SQL migrations folder. The `api` container runs
`prisma db push` on every start, so a deploy syncs the DB automatically — no separate
migration step.

## Configuration

Copy [`deploy/.env.example`](../deploy/.env.example) to `deploy/.env` on the host and fill
it in (it is git-ignored). Required values:

| Var | Purpose |
|-----|---------|
| `DB_PASSWORD` | Postgres superuser password (db container + api `DATABASE_URL`). |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Auth secrets — `openssl rand -hex 32` each. |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (your domain + any test IPs). |
| `APP_PUBLIC_URL` | Public base URL used to build invite links in emails. |
| `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outbound email via an SMTP relay (residential IPs can't send direct mail — use Gmail app password, Brevo, etc.). |

## Deploying a new version

From a local checkout, [`deploy/push-to-wend.sh`](../deploy/push-to-wend.sh) rsyncs the
code, rebuilds the images on the host, and restarts:

```bash
./deploy/push-to-wend.sh
```

Overridable via env:

| Var | Default | |
|-----|---------|--|
| `PROD_HOST` | `bogdan@192.168.1.139` | ssh target |
| `PROD_DIR` | `~/app` | compose dir on the host |
| `SERVICES` | `api web` | services to rebuild |

The script excludes `.git`, `node_modules`, `dist`, and `.env*` from the rsync, so the
host keeps its own `deploy/.env`. After rebuild it runs `docker compose up -d` and prints
`docker compose ps`.

### On the host directly

```bash
cd ~/app
docker compose build api web
docker compose up -d
docker compose logs -f api        # watch startup (prisma db push + server boot)
docker compose ps
```

## Running scripts on the prod host

Reseeds, period reopens/prepares, and backfills run in a **one-off container** against the
prod DB. The plain invocation does **not** work — the image's tsconfig isn't in effect, so
ts-node emits TC39 decorators and any script that imports the Nest graph dies with
`TypeError: Cannot read properties of undefined (reading 'value')` at `__esDecorate`. You
must bind-mount `tsconfig.json` **and** force the legacy decorator options:

```bash
cd ~/app                       # the compose dir on the host
docker compose run --rm \
  -v "$HOME/app/backend/src:/app/src" \
  -v "$HOME/app/backend/data:/app/data" \
  -v "$HOME/app/backend/scripts:/app/scripts" \
  -v "$HOME/app/backend/tsconfig.json:/app/tsconfig.json" \
  -e 'TS_NODE_COMPILER_OPTIONS={"module":"commonjs","experimentalDecorators":true,"emitDecoratorMetadata":true,"useDefineForClassFields":false}' \
  --entrypoint npx api ts-node --transpile-only src/scripts/prepare-period.ts Kralik 2026-05
```

Swap the last part for another script, or use `--entrypoint bash api scripts/rebuild-kralik-nobridge.sh`
for a full community rebuild.

⚠️ A first attempt **without** the tsconfig mount once left prod half-reseeded (history
through April, no May, no cash, no corrections). Re-running the full rebuild with the correct
invocation repaired it, because the script wipes and rebuilds — but treat a failed prod reseed
as an outage until you've verified the period status, statement count, and fund totals
afterwards (see the checks in [data-reseed.md](./data-reseed.md#verifying-the-result)).

## First-time / on-host setup

1. Install Docker + Compose on the host.
2. Create `~/app/backend` (the rsync target) and `~/app/deploy/.env`.
3. Point Cloudflare DNS at the host, SSL mode **Flexible** (Cloudflare → origin over :80).
4. First `docker compose up -d --build`; then seed the root admin inside the api
   container if needed (`docker compose exec api npm run seed`).

## Legacy: AWS/ECR

`build-and-push.sh` (repo root) and the root `README.md` describe an older AWS ECR/ECS +
CDK target. It is **not** the current production path — the live deployment is the
Compose stack above. Keep it only if/when you move back to AWS.
