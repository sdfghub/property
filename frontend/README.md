# Property Expenses — Frontend

Vite + React single-page console for the API in `../`. It speaks to the Nest endpoints (magic-link auth, communities, billing drill-downs).

## Run it
```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

The client uses `VITE_API_BASE_URL` (default `http://localhost:3000/api`). Backend routes live under that single `/api` prefix.

## Features
- Magic-link auth: request link, consume token from `?token=` or paste manually.
- Lists communities accessible to the logged-in user.
- Billing explorer: give a period code and inspect billing entities, members, allocation lines, and per-unit allocations.
- Language toggle (EN/RO) in the header. Strings live in `src/i18n/lang.ts`.
- Role switcher: if the access token contains multiple roles, pick which perspective to use. `SYSTEM_ADMIN` view includes community admin management (list, revoke, invite).

## Notes
- Access tokens are stored in `localStorage`; refresh is attempted automatically on 401s.
- Styles are handcrafted (no Tailwind/Chakra). Adjust `src/styles/index.css` to match your brand.
