# DevOps & Operations docs

Operational documentation for the Property Expenses app (NestJS + Prisma backend,
Vite/React frontend, Postgres).

| Doc | What it covers |
|-----|----------------|
| [local-dev.md](./local-dev.md) | Running the whole stack on your machine: Postgres, backend API, frontend, seed admin, ports, env vars. |
| [data-reseed.md](./data-reseed.md) | Wiping and rebuilding a community's data from its committed source (Kralik April/May flow + the `rebuild-*.sh` scripts). |
| [deployment.md](./deployment.md) | Shipping to the prod host (`wend` / vicusia.ro): Docker Compose stack, Caddy + Cloudflare, the `push-to-wend.sh` flow. |

> The repo-root `README.md` predates this setup and documents an older AWS/CDK target
> (ports 3000/5432). Treat the docs in this folder as the source of truth for how the
> app actually runs today.
