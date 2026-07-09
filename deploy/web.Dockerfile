# Web image: builds the SPA (frontend) and serves it via Caddy, which also
# reverse-proxies /api to the api service. Build context is the repo root.
FROM node:20-slim AS build
WORKDIR /app
COPY packages ./packages
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend ./frontend
# Never let a dev-only .env.local (e.g. VITE_API_BASE=http://localhost:3100/api) leak
# into the production bundle — it would make the browser call a dead address.
RUN cd frontend && rm -f .env.local .env.*.local && npm run build

FROM caddy:2-alpine
COPY --from=build /app/frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
