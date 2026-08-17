# Property — Frontend

Vite + React single-page console for the API in `../` (the repo root is the backend
project). Admin, censor/committee, and owner views over the same endpoints.

## Run it

```bash
cd frontend
npm ci                                                  # own package.json + lockfile
echo 'VITE_API_BASE=http://localhost:3100/api' > .env.local
npm run dev                                             # http://localhost:5173
```

`.env.local` is **required**: `src/api/client.ts` reads `VITE_API_BASE` (or
`VITE_API_BASE_URL`) and otherwise falls back to same-origin `/api`, which does not reach the
backend on :3100 — you get silent 404s, not an error message. The backend already allows
`http://localhost:5173` via `APP_ORIGIN`.

Optional: `VITE_FCM_*` keys for web push.

Or start the whole stack (DB + API + this) from the repo root:
`bash scripts/start-dev.sh`.

## Checks

```bash
npm run typecheck    # tsc --noEmit → 70 pre-existing errors; don't add more
npm run check:i18n   # every t() key present in BOTH en and ro — must pass
npm run build        # vite build (does NOT typecheck)
```

## Conventions

Read [../docs/frontend-conventions.md](../docs/frontend-conventions.md) before adding UI. The
two rules that get violated most:

1. **No hardcoded domain knowledge.** Codes, labels, and taxonomies come from the backend —
   per-community data inside the endpoint payload, fixed taxonomies from `GET /metadata` via
   `useMetadata()`. Never a local `{ APA_RECE: 'Apă rece', … }` map.
2. **Every string through i18n, in both languages.** Keys live in `src/i18n/lang.ts`
   (`en` + `ro`, flat, at parity); `t(key, varsOrFallback)`. A missing key renders as the raw
   key on screen. `npm run check:i18n` enforces it.

## Layout

- `src/components/community-admin/` — admin screens; `CommunityAdminDashboard.tsx` is the tab
  host (tab key + nav entry + render switch all need updating when you add one).
- `src/components/meters/` — meter entry (grouped by unit, per-unit subtotals).
- `src/api/client.ts` — fetch wrapper; tokens in `localStorage`, refresh retried on 401.
- `src/hooks/` — `useAuth`, `useMetadata`, `useI18n`.
- `src/styles/index.css` — handcrafted styles (no Tailwind/Chakra).

## Notes

- Auth: password login + magic-link/invite flows; a role switcher appears when the token
  carries several roles.
- The SPA is served in production by Caddy from the built `dist/` — see
  [../docs/deployment.md](../docs/deployment.md).
