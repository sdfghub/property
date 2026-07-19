# Frontend conventions

## The frontend must not hardcode domain knowledge

Codes, labels, and taxonomies that belong to the domain live on the **backend**. The
frontend renders whatever the backend sends. This was a deliberate cleanup — do not
reintroduce hardcoded code→label maps or code enumerations in components.

**Smell to avoid:**

```tsx
// ❌ DON'T: the frontend now "knows" domain codes and their labels
const CAT_LABEL = { APA_RECE: 'Apă rece', PENALIZARI: 'Penalizări', ... }
const STRATEGIES = [{ key: 'FIFO', label: 'Cronologic (FIFO)' }, ...]
const IMPACT_TAGS = ['WATER', 'HEAT', 'ELEVATOR', ...]
```

**Do instead:** fetch the labels/enumeration from the backend and render them.

### Two sources, by nature of the data

1. **Per-community / dynamic data** (expense-type names, fund names) — comes back inside
   the relevant endpoint's payload. Example: `finance.service.avizier()` returns
   `categoryLabels` (built from the community's `ExpenseType.name` + `Fund.name` in the
   DB), and `AvizierPanel` renders those instead of a hardcoded map.

2. **Fixed system taxonomies** (roles, notification channels, committee statuses, impact
   tags, BE roles, meter modes, water methods) — come from the central registry
   `src/common/enums-meta.ts`, served by `GET /metadata` (a global, static, auth-only
   route in `src/modules/metadata/`). The frontend consumes it via the
   `useMetadata()` hook (`frontend/src/hooks/useMetadata.tsx`).

```tsx
import { useMetadata, labelOf } from '../../hooks/useMetadata'

const meta = useMetadata()
// enumerate options:
{meta?.impactTags.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
// label a single code:
<span>{labelOf(meta?.notificationChannels, pref.channel)}</span>
```

`useMetadata()` returns `{ roles, governanceRoles, beRoles, notificationChannels,
committeeDecisionStatuses, impactTags, audienceTypes, meterModes, waterMethods }`, each an
array of `{ key, label, hint?, tone? }`.

### Single source of truth on the backend

`common/enums-meta.ts` is the source of truth for these codes **and** their labels. Where
the backend also needs a validation list, derive it from the same registry so the two
never drift:

```ts
// communications.service.ts
const IMPACT_TAGS = new Set(metaKeys(IMPACT_TAG_META))
// invite.controller.ts
const allowedCommunityRoles = GOVERNANCE_ROLE_KEYS
// invite.service.ts roleLabel() reads ROLE_META
```

Feature flags follow the same idea via their own module: `features.service.FEATURE_META`
served by `GET /communities/:id/features/registry`; payment strategies via
`payment-allocation.ALLOCATION_STRATEGY_META` returned inside the
`GET /communities/:id/payment-allocation` payload.

### Adding a new taxonomy

1. Define/confirm the enum in `prisma/schema.prisma` (or the owning service).
2. Add a `*_META` array to `common/enums-meta.ts` and include it in `COMMUNITY_METADATA`
   (and the `CommunityMetadata` type in `useMetadata.tsx`).
3. If the backend validates the codes, derive that list from the meta (`metaKeys(...)`).
4. In the component, `useMetadata()` and render `.label` (never a local map).

### What legitimately stays in the frontend

Not everything flagged as "a code in the frontend" is a domain-data leak. These are UI
structure/behavior, not labels, and are fine:

- **i18n keys** and generic UI copy (that's what i18n is for). Backend labels are used as
  the *fallback* under an i18n override, e.g. `t('role.'+r, labelOf(meta?.roles, r))`.
- **Behavior branches** on a backend-supplied value, e.g. a meter in `INDEX` vs
  `CONSUMPTION` mode renders a different input — the mode comes from the backend, the
  branch is UI logic.
- **Frontend-only structures** with no backend definition: the close-period wizard's own
  step keys, and rendering conventions keyed off a backend-emitted code (e.g. the avizier
  `PEN:<fund>` category prefix, or `ALLOCATED_EXPENSE`). The code originates on the
  backend; the frontend just decides how to draw it.

## Misc

- **API client**: `frontend/src/api/client.ts` reads `VITE_API_BASE` (see
  [local-dev.md](./local-dev.md)); components call it through `useAuth().api`.
- **i18n**: `useI18n()` returns a `t(key, params?)` where the 2nd arg is interpolation
  params, not a default string. Many components wrap it as
  `const t = (k, d='') => { const v = rawT(k); return v && v !== k ? v : d }` to get a
  default-string helper — follow that pattern in new components.
