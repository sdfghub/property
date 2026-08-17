# Docs

Documentation for the Property Expenses app (NestJS + Prisma backend, Vite/React frontend,
Postgres). **New here? Start with [onboarding.md](./onboarding.md).**

| Doc | What it covers |
|-----|----------------|
| [onboarding.md](./onboarding.md) | **Day one**: repo layout, setup, loading real data, project rules, what "green" means, git conventions. |
| [local-dev.md](./local-dev.md) | Running the stack: Postgres, API, frontend, `start-dev.sh`, ports, the full env-var table, gotchas. |
| [architecture.md](./architecture.md) | The domain model: topology, periods, funds, allocation, statements/ledger, payments, penalty aging, charge overrides, corrections, meters, the avizier. |
| [meters.md](./meters.md) | Meter → reading → measure, the `(scope, typeCode)` aggregation rule, INDEX vs CONSUMPTION, and why allocation hard-errors instead of splitting equally. |
| [corrections.md](./corrections.md) | Reshuffles, credit transfers, penalty write-offs, manual adjustments: declarations with a **derived** ledger. |
| [frontend-conventions.md](./frontend-conventions.md) | No hardcoded domain knowledge (metadata registry + `useMetadata()`) and the EN/RO i18n contract. Read before adding UI. |
| [data-reseed.md](./data-reseed.md) | Wiping and rebuilding a community from its committed source — `rebuild-kralik-nobridge.sh` and friends. |
| [kralik.md](./kralik.md) | The live association's modelling: afisare window, back-penalty forgiveness, apa-dif water split, data caveats. |
| [deployment.md](./deployment.md) | Shipping to prod (`wend` / vicusia.ro): Compose stack, Caddy + Cloudflare, `push-to-wend.sh`, running scripts on the host. |
| [reports/collection-rate.md](./reports/collection-rate.md) | The "grad de colectare" report: the owed/paid/outstanding identity, fund domains, CPI, deliberate deviations from the spec. |

Conventions an agent should load automatically live in the repo-root
[`CLAUDE.md`](../CLAUDE.md); it points back here rather than duplicating detail.
