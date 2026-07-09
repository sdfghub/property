# Production deploy

Self-contained Docker Compose deploy of the Property Expenses app:

- **db** — Postgres 16 (persistent volume `pgdata`)
- **api** — NestJS backend, served under `/api`
- **web** — Caddy serving the built SPA and reverse-proxying `/api` → api

Everything builds straight from a checkout of this repo (build context is the repo
root), so the deploy is reproducible from git alone — no rsync or hand-copied files.

## Prerequisites

- A Linux host with **Docker** + **Docker Compose v2** (`docker compose version`).
- Ports **80** (and optionally 443) reachable. Behind Cloudflare, forward the router's
  :80 to the host.

## First deploy

```bash
git clone https://github.com/sdfghub/property.git
cd property/backend/deploy

cp .env.example .env
# Edit .env: set DB_PASSWORD, JWT secrets (openssl rand -hex 32), CORS_ORIGINS,
# APP_PUBLIC_URL, MAIL_FROM + SMTP_*, ADMIN_PASSWORD.

docker compose up -d --build
docker compose ps            # db healthy, api + web up
```

The api container runs `prisma db push` on start, so the schema is created
automatically (this repo has **no** SQL migrations folder).

### Seed the root admin

The seed script runs under ts-node; in the container it needs its module options
forced (otherwise TS5109 / NodeNext). Pass the admin password explicitly — do **not**
`source .env` in a shell (the `<...>` in `MAIL_FROM` breaks shell parsing):

```bash
docker compose exec -T \
  -e TS_NODE_TRANSPILE_ONLY=1 \
  -e TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
  -e ROOT_PASSWORD='your-admin-password' \
  api npm run seed
# Root email defaults to bogdan.boji@gmail.com; override with -e ROOT_EMAIL=...
```

Log in at `APP_PUBLIC_URL` with that email + password.

## TLS / DNS (Cloudflare)

The origin serves plain **HTTP on :80**; Cloudflare terminates TLS at the edge.

1. Proxied (orange-cloud) `A` records `@` and `www` → the host's public IP.
2. Router forwards :80 → host.
3. SSL/TLS mode **Flexible**.

For end-to-end encryption, upgrade to **Full (strict)**: forward :443, create a
Cloudflare **Origin Certificate**, and add a `:443 { tls <cert> <key> ... }` block to
`Caddyfile` (the compose already publishes 443).

## Updating

```bash
cd property/backend && git pull
cd deploy && docker compose up -d --build
```

`index.html` is served `no-cache` and assets are content-hashed + immutable, so
browsers pick up new builds automatically (no hard refresh needed).

## Reseeding a community (e.g. Kralik)

The api image has node_modules + ts-node but not `src/`, `data/`, or `scripts/`.
Run the community rebuild in a one-off container with the source bind-mounted, joined
to the compose network, against the `db` container. The **full** `TS_NODE_COMPILER_OPTIONS`
is required (the containerized ts-node ignores the repo tsconfig — without it you get
TS5109 *and* broken NestJS decorators):

```bash
# from the repo root, with $DB_PASSWORD from your deploy/.env:
docker run -d --name kralik-seed --network deploy_default \
  -e DATABASE_URL="postgres://postgres:$DB_PASSWORD@db:5432/property_expenses?schema=public" \
  -e TS_NODE_TRANSPILE_ONLY=1 \
  -e TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node","target":"ES2020","experimentalDecorators":true,"emitDecoratorMetadata":true,"useDefineForClassFields":false,"esModuleInterop":true}' \
  -v "$PWD/src:/app/src" -v "$PWD/data:/app/data" -v "$PWD/scripts:/app/scripts" \
  -w /app --entrypoint bash deploy-api scripts/rebuild-kralik.sh
docker logs -f kralik-seed
```

(The compose project name comes from the directory — from `deploy/` it is `deploy`,
so the network is `deploy_default` and the api image is `deploy-api`. Adjust if you run
compose from elsewhere or with `-p`.)

## Notes

- The repo-root `docker-compose.yml` is a **dev** convenience (Postgres only, on host
  :5540) — unrelated to this production stack.
- Email: `MailService` uses SMTP when `SMTP_HOST` is set, else Resend (`RESEND_API_KEY`),
  else logs to stdout. See the app's invite flow for how invites are sent.
