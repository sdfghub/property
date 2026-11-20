#!/usr/bin/env bash
# Preview the website + app together, the way prod serves them: real Caddyfile, website on /,
# app on /app, /api proxied to the local dev API on :3100. Open http://localhost:8080.
#
# Usage: bash scripts/preview-site.sh        Needs Docker and the API from scripts/start-dev.sh.
# Stop:  docker rm -f vicusia-preview
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist/site-preview"   # dist/ is ignored by git and by the prod rsync
PORT="${PORT:-8080}"

node "$ROOT/site/build.mjs"
rm -rf "$OUT" && mkdir -p "$OUT"
# Same-origin API, as in prod. The env var beats frontend/.env.local, which points at :3100.
( cd "$ROOT/frontend" && VITE_API_BASE=/api npx vite build --outDir "$OUT/srv" --emptyOutDir --logLevel warn )
cp -R "$ROOT/site/dist" "$OUT/srv/site"
# The dev API only allows the Vite origin; prod is same-origin, so this applies to the preview alone.
awk '/reverse_proxy api:3000/ {
  print "reverse_proxy host.docker.internal:3100 {"; print "header_up Origin http://localhost:5173"; print "}"; next
} { print }' "$ROOT/deploy/Caddyfile" > "$OUT/Caddyfile"

docker rm -f vicusia-preview >/dev/null 2>&1 || true
docker run -d --name vicusia-preview -p "$PORT:80" \
  -v "$OUT/srv:/srv:ro" -v "$OUT/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
echo "http://localhost:$PORT  (website)   http://localhost:$PORT/app  (login)"
