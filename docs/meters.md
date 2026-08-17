# Meters & measures

How a number a person types into the meter form becomes the quantity the billing engine
splits a water bill by. Three layers, in order:

| Layer | Table | Grain | Who reads it |
|-------|-------|-------|--------------|
| **Meter** | `meter` | one physical device, **no period** | the meter-entry form (which rows to show) |
| **MeterReading** | `meter_reading` | one device × one period (`@@unique([periodId, meterId])`) | the form (to prefill), the rollup |
| **PeriodMeasure** | `period_measure` | one `(scope, typeCode)` × one period | **allocation, aggregations, the avizier** |

Meters come from the community definition (`data/<COMM>/def.json` → `meters[]`:
`scopeType`, `scopeCode`, `typeCode`, `meterId`, optional `openingIndex`). Which meters
appear in a monthly entry form comes from `data/<COMM>/meter-entry-templates.json`.

## The aggregation rule

> A meter belongs to the measurement identified by its **`(scope, typeCode)`** — the type
> says *what kind of quantity*, the scope says *whose*. **All meters sharing that pair are
> summed** into one `PeriodMeasure`.

The sum is hardcoded (`TemplateService.rollupUnitMeasure`, `src/modules/billing/template.service.ts`)
and assumes metered quantities are additive. The **only** way to keep two meters apart in
billing is to give them a different `typeCode` (or a different scope). So a unit with a
bathroom and a kitchen cold-water meter gets one `WATER_COLD` measure equal to their sum —
which is the intended behaviour, and also why this layer exists: before it, both meters
wrote the same `PeriodMeasure` and the second silently overwrote the first.

`PeriodMeasure.origin` is `DERIVED` for rolled-up values, and its `meterId` column is a
synthetic `"<typeCode>-<scopeId>"` label, **not** a real device id — never join on it.

## Write path

`TemplateService.upsertMeterReading` (used by the meter-entry form and the self-service
"my readings" screen):

1. resolve the `Meter` by `meterId`, and its scope (`UNIT` → the unit's id, `COMMUNITY` →
   the community id);
2. resolve the reading **mode** for that measure type;
3. write the raw `MeterReading` for that exact device (upsert on `(periodId, meterId)`);
4. `rollupUnitMeasure(...)` → the `(scope, typeCode)` `PeriodMeasure` = Σ readings;
5. `recomputeAggregationsAndDerived(...)` → community totals, derived measures
   (e.g. `WATER_RESIDUAL`).

Read path (form prefill) goes to `MeterReading` by `meterId`, so each device shows its own
value rather than the scope aggregate.

## INDEX vs CONSUMPTION mode

Per community, per measure type, from `community.measureModes` (a JSON map
`typeCode → 'INDEX' | 'CONSUMPTION'`, set by the importer from `def.json` `measureTypes[]`,
editable in the admin **MeasureModePanel**). Default is `CONSUMPTION`.

- **CONSUMPTION** — the entered number *is* the period's consumption (`reading` stays null).
- **INDEX** — the entered number is a cumulative index; consumption = `entered − prior`,
  where `prior` is the last prior period's `reading` or the meter's `openingIndex`.
  Negative diffs clamp to 0. Writing a reading also recomputes the **next** period's
  consumption (`recomputeNextConsumption`), because one index bounds two periods.

⚠️ **Known gap — per-meter INDEX is unsupported when a scope has several meters.** The
prior-index lookup (`priorReadingValue`) reads `PeriodMeasure.reading` keyed by
`(scope_type, scope_id, type_code)`, and the rollup only keeps `reading` when the scope has
**exactly one** meter. Two INDEX meters on the same `(scope, type)` therefore lose their
individual baselines. Fixing it means keying reading history by `meterId` and deriving each
meter's delta before the sum. Kralik is CONSUMPTION, so nothing is broken today.

## Allocation never falls back

`src/modules/billing/allocation.service.ts`: a metered allocation (`BY_CONSUMPTION`,
`BY_SQM`, …) whose units are missing a `PeriodMeasure` **throws** `ForbiddenException`,
naming the units — it does not split equally:

```
Missing WATER_COLD reading for 3 unit(s): U6-AP 1, U7-AP 2, … Enter the reading(s)
before allocating (equal-split fallback disabled).
```

All four sites are guarded (the split and one-off paths, each for "no measures at all" and
"some units missing"). This blocks `prepare`/`close` until readings are entered, for every
community — deliberately, because a silent equal split produces plausible-looking wrong
bills that nobody catches.

## Kralik specifics

Kralik's source data only ever gives **per-unit cold-water totals**, never per-bathroom /
per-kitchen. So `def.json` defines exactly **one** `WATER_COLD` meter per unit
(`M_<unitCode>_WATER_COLD`, label "Apă rece") — 31 unit meters — and
`meter-entry-templates.json` has one item per unit. Mode is CONSUMPTION;
`waterDifferenceMethod` is `APA_DIF` and the residual splits `BY_CONSUMPTION` weighted by
`WATER_COLD` (see [kralik.md](./kralik.md)).

The meter-entry form (`frontend/src/components/meters/MeterEntryForm.tsx`) groups rows by
unit, prettifies unit codes (`400191-C1-U6-AP 1` → `U6-AP 1`), and shows a live per-unit
subtotal when a unit has more than one meter.

## Reseed plumbing (matters every time you rebuild)

`wipe:community` **cannot** clean two things, so `scripts/rebuild-kralik-nobridge.sh` runs
them explicitly (see [data-reseed.md](./data-reseed.md)):

- `npm run prune:meters -- <COMM>` — `Meter` has no `communityId`, so removed devices would
  otherwise survive a wipe (that's how a 31-unit community once ended up with 93 meters).
  It scopes deletion by the community's unit codes and drops orphan readings too.
- `npm run backfill:meter-readings -- <COMM>` — the wipe doesn't know the `MeterReading`
  table. It clean-rebuilds readings from existing measures (remapping a synthetic per-unit
  aggregate onto the scope's first real device, skipping derived/static types like
  `WATER_RESIDUAL`, `SQM`, `RESIDENTS`), so `Σ readings == PeriodMeasure` and billing is
  unchanged.
