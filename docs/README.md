# DevOps & Operations docs

Operational documentation for the Property Expenses app (NestJS + Prisma backend,
Vite/React frontend, Postgres).

| Doc | What it covers |
|-----|----------------|
| [local-dev.md](./local-dev.md) | Running the whole stack on your machine: Postgres, backend API, frontend, seed admin, ports, env vars. |
| [architecture.md](./architecture.md) | The domain model: communities, periods, funds, charges/allocation, statements/ledger, payments, penalty aging, charge overrides, the avizier. |
| [frontend-conventions.md](./frontend-conventions.md) | The "no hardcoded domain knowledge" rule — backend metadata registry + `useMetadata()`. Read before adding UI that lists codes/labels. |
| [data-reseed.md](./data-reseed.md) | Wiping and rebuilding a community's data from its committed source (Kralik April/May flow + the `rebuild-*.sh` scripts). |
| [kralik.md](./kralik.md) | Kralik-specific modelling: afisare penalty window, back-penalty forgiveness, apa-dif water split, charge overrides, data caveats. |
| [deployment.md](./deployment.md) | Shipping to the prod host (`wend` / vicusia.ro): Docker Compose stack, Caddy + Cloudflare, the `push-to-wend.sh` flow. |
| [reports/collection-rate.md](./reports/collection-rate.md) | The "grad de colectare" report: the owed/paid/outstanding identity, fund domains, CPI, and the deliberate deviations from the source spec. |

> The repo-root `README.md` predates this setup and documents an older AWS/CDK target
> (ports 3000/5432). Treat the docs in this folder as the source of truth for how the
> app actually runs today.
