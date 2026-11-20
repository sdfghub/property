# Buget vs Forecast vs Actual

Implements `VICUSIA_Palatul_Kralik_Model_de_bugetare.docx` (§7–8, §12–13). UI: **Bani → Buget vs
Forecast vs Actual** (`BudgetPanel.tsx` + `BudgetViews.tsx`), five views: **Pe servicii** (Domeniu →
Serviciu in avizier order — `associationInfo.serviceConfig.domains`, a service placed by the first
avizier expense type its lines read; Run / Maintain / Transform bar, service level 0–5), **Pe fond**
(funds in `avizierConfig.fundOrder` order, EXPENSES first; "ascunde fondurile fără sume"), **Proiecte**
(program → project financial structure: budget, tranches per year, paid, rest de plată, per area /
vendor / fund / service), **Multi-an** (`multiYear`: budget only, per year from Portofoliu, by domain →
service (service-split weights) or by fund; line years in `BudgetLine.yearPlan`) and **Pe dimensiune** (the
original line table). Codes are not shown in the UI. **Year selector** (`?years=2025,2026`, default the
fiscal year; Trecut / Anul curent / Viitor / Toți anii): `yearItems()` gives every line/project a
budget, actual and forecast per year (past actual = closed avizier charges of the line's expense
types, or dated Contract-Factura payments; past forecast = actual; later forecast = budget, or the
project's remaining cost spread over its later tranches) and every view sums the selected years
(`selection` in the payload). Each view has „ascunde înregistrările cu zero”. **Pe an / Pe luni**: every item also carries `byMonth` (Jan–Dec of
each year: budget = phasing or yearly ÷ 12; actual = avizier charges per period / payments per date
month; forecast = actual + the year's unpaid forecast spread over the months still to come), every
total has `months`, so in monthly mode each view shows one column per month for one metric (Buget /
Actual / Forecast / Abatere); Multi-an shows the budget per month. Month sums equal the year figures.
Definitions of the four metrics are on the page („Ce înseamnă …”). **lei / € switch**: `budgetFx.ts` converts the
payload client-side with `BudgetVersion.fxRates` (per year: ECB yearly mean = BNR yearly average;
running year = mean to date; later years = last rate) — year-keyed maps convert year by year, project
budget/paid are re-summed from their years, everything else uses the fiscal-year rate; the line
detail modal stays in RON. Default rates: `EUR_RATES` in `gen-budget.py` (ECB yearly means), except the
years in `EUR_YEAR_FUND` (2025 = Fond Reabilitare 2 = 350.000 €, 2026 = Fond Reabilitare 3 = 170.000 €,
EUR amounts from „Buget - Sumar”; rate = the fund's Portofoliu budget that year ÷ EUR); later years
repeat the last one. With € on, the page shows „Curs EUR pe ani” for the selected years, editable
(`PATCH /communities/:id/budget/fx-rates` {year, rate} or {year, fundCode, eur}; COMMUNITY_ADMIN);
edited rates are flagged `manual` and survive a re-import.
**Fond de rulment** is a Run line (`budgetFromFundTarget`: budget = the RULMENT fund target; actual =
every RULMENT charge on the avizier) under service „Financiar” (Administrativ) — the working-capital fund is part of Financiar, not a service of its own. „Alte cheltuieli” is not a service (`SERVICE_SKIP`); a Portofoliu row with no service stops the generator. Purpose colours are tokens `--purpose-run /
-maintain / -transform` (green / yellow / red, Vicusia service-level scale) in `index.css`. API:
`GET /communities/:id/budget[?version=]` and `GET /communities/:id/budget/lines/:lineId`.

## Model
- `BudgetVersion` → `BudgetLine` → `BudgetEntry`; `BudgetProgram` → `BudgetProject` (strategic);
  `BudgetServiceDef` = service catalogue (linked to the evaluated `ServiceItem` for its level).
- `serviceSplit` ([{code, weight}], weights sum to 1) on lines and projects: a shared cost is split over
  services by the workbook's "Proiect - Serviciu" sheet. `BudgetProject.yearPlan` = budget tranche per year;
  `BudgetVersion.fundPlan` = the funds the workbook names, incl. ones not yet set up in the app (`appFund=false`).
- **Annual views** (`payload.annual`): items = every operational/tactic line + each project's slice of the
  fiscal year (budget = the year's tranche; actual = payments dated in the year; forecast = actual + the
  remaining project cost spread over the tranches from this year on, all of it in this year when the
  tranches are past = "tranșe depășite"). By service, fund, purpose and project sum the same items;
  `annual.check` shows the four totals.
- Each line has two independent fund fields (model §7): `dimension` = managerial fund
  (OPERATIONAL = FM-OPE, TACTIC = FM-TAC with PREVENTIVE/REACTIVE, STRATEGIC = FM-STR) and
  `fundCode` = the legal fund that pays it (`Fund.code`; null = de confirmat).
- `basis` stores how the budget number was computed; the line modal shows it verbatim.

## Numbers
- **Operational / tactic lines with `actualSource.type = EXPENSE_TYPES`**: actuals are read live from
  `community_charge` (EXPENSES fund, CLOSED periods), with VENDOR_INVOICE item keys resolved
  through each invoice's bill template. Forecast = actual + draft (PREPARED) month + remaining
  months × mean of the last 3 closed months (`forecastMethod` RUN_RATE | BUDGET | NONE).
- **Strategic lines**: entries from the project plan. Actual = Σ PAYMENT, Angajat = Σ COMMITMENT,
  Forecast = max(Actual, Angajat, Estimare). Strategic is multi-year (project total), the others annual.
- **Per unit**: the line × the share each unit got in the last real allocation of the same expense types
  (or fund); fallback to the SQM measure. Payments from several funds follow each fund's own key.

## Loading
```
python3 data/Kralik/gen-budget.py "<…>/Kralik - Buget - 2026.xlsx" 2026 > data/Kralik/budget-2026.json   # needs openpyxl
npm run import:budget -- Kralik 2026      # reads data/Kralik/budget-2026.json; rebuilds version BUG-2026
```
Workbook sheets: Structura buget (catalogue), Proiect - Serviciu (weights), Portofoliu (programs, projects,
fund, vote year, budget RON/EUR, amount per year; the fiscal year's column = annual budget of operational
and tactic items), Contract-Factura (Bugetat / Datorat / Plătit). The generator holds what the workbook
can't say: workbook fund label → app fund, item → app expense types (live actuals), service → evaluated
service. Contract-Factura rows filed under "3. …" with Categorie Instalatii / Constructie - Specialitati go
to those Portofoliu projects; the "Majorări" row (no project) goes to project 2.
`gen-budget-rehab.py` / `budget-rehab.json` (old Project Plan v0.7 format) are no longer read.
The import is idempotent and never writes ledger, charge or invoice rows.

## Excel export (classic budget layout)
Same layout as the association's yearly budget sheet (Nr crt / Capitol / Denumire / Status / Furnizor /
Fond / Ianuarie…Decembrie / SIM / Total / T1–T4 / … / Comentarii), grouped I. Venituri → II. Cheltuieli
(A Operațional, B Tactic: B.1 preventiv / B.2 reactiv, C Strategic: C.n per project) → III. Fonduri.
```
npm run export:budget -- Kralik /tmp/budget.json            # read-only dump (rollup + every line)
python3 scripts/budget_to_xlsx.py /tmp/budget.json out.xlsx 2023  # needs openpyxl; 2023 = first year sheet
```
Sheets: `Sumar pe ani` (real per year, budget/actual/forecast for the fiscal year), `Portofoliu`
(strategic lines with payments per year), one sheet per past year from <first year> (realised: closed-period
cost per line, fund contributions billed, dated payments), `<an>-Sumar` (per dimension/project and per fund), `<an>-Buget` (budget phased by month;
strategic = project baseline, unphased), `<an>-Exec` (closed months = actual, then draft/forecast;
strategic months = dated payments, "Nefazat" = forecast − paid). Totals are Excel formulas.
A strategic line paid from several funds gets extra "↳ plăți din <fond>" rows so the fund section
sums per fund exactly. The repairs provision shows 0 actual in closed months; its unspent part is
kept as "Nefazat" (the app assumes the provision is used in full).

## Services catalogue, dashboard and one order

`ServiceItem` (the evaluated services) is the **single services list**: every budget service links
to one (`BudgetServiceDef.serviceItemId`, `SPEC` in `gen-budget.py`); the import creates the missing
catalogue entries (Lift, Energie, DDD, Juridic, Internet, Clădire / Întreținere clădire, …).
- **Dashboard** (Acasă → Today, `ServicesDashboard.tsx`): services by domain, operational status
  (`ServiceItem.status`: Nefuncțional red, Parțial funcțional yellow, Funcțional green,
  Indisponibil grey, Oprit black — labels/tones from `SERVICE_STATUSES`) and satisfaction = the
  evaluation level x/5. Status values (`SERVICE_STATUSES.value`, with definitions): Nefuncțional 0
  (external/unforeseen cause, red), Risc mare 1 (partly working, high risk, orange), Parțial funcțional 2,
  Funcțional 3, Oprit −1 (stopped on purpose),
  Indisponibil −2 (does not exist now); listed highest value first. `aggregates` (per domain + overall, `aggregateServices`):
  status = mean of the 0–3 values (stored with one decimal, shown rounded to a whole number, the decimal on hover) (negative / unset left out); satisfaction = mean of the 0–5 levels
  of evaluated services (null left out). An Indisponibil service has no evaluation
  (`satisfactionOf` → null, shown –/5, also in the budget); a domain with every service Indisponibil
  is itself Indisponibil (`statusCode`; only Indisponibil/Oprit with one Oprit → Oprit).
- **Trend** (`trendSince` = last month): ▲/▼ next to x/5 compares today's satisfaction with the state
  at the end of last month (latest `service_assessment` before the 1st; a status not recorded then
  is taken as today's). Domains/overall compare like with like (only services evaluated in both).
- **Change log**: click a service on the dashboard → every history row, newest first, listing only
  what changed (satisfaction, status, work stage, priority, comment, actions) and who saved it. Toggle „arată serviciile inexistente” hides grey services. Admin: change status (`PATCH /communities/:id/services/:itemId/status`,
  history row in `service_assessment`) and order (`PATCH /communities/:id/services/order` {ids}).
- **One order**: saving the order renumbers `ServiceItem.sortOrder` (domains contiguous) and
  rewrites the avizier's `associationInfo.serviceConfig.domains` (+ the flat `default` list) via
  `ServicesService.syncAvizierOrder`: an expense type follows the catalogue service its budget lines
  are booked on; unlinked ones (e.g. PENALITATI_APA) stay right after their previous neighbour. The
  budget groups and orders services by the catalogue (name, domain, `sortOrder`).
- **Provider**: `ServiceItem.providedBy` (`SERVICE_PROVIDERS`, e.g. MUNICIPALITY = primăria) marks
  services the association follows but does not contract or pay (Iluminat public, Ordinea și
  liniștea publică, Întreținerea domeniului public, Deszăpezire și combatere polei): italic name with
  an asterisk explained on hover and in a footnote. They count in the averages like any service.
- **Evaluare servicii** (ServicesTab + ServicesReport) shows the same data as the dashboard: status
  column (editable in the evaluation form — `assess()` takes an optional `status`; Indisponibil saves
  an empty level), satisfaction (`satisfaction`), domain/overall averages and trends (shared
  `AggregateRow` / `TrendMark` / `Dot`), italic + asterisk for city-hall services, and the same
  „arată serviciile inexistente” switch (same remembered choice).
- **Cost type** (`BudgetLine.costType`, labels `BUDGET_COST_TYPE_META`): set by the generator from the
  Portofoliu program (`PROGRAM_COST_TYPE`: Utilități → Consum, Servicii furnizor → Abonament,
  Mentenanțe proactive → Mentenanță preventivă, Mentenanțe reactive → Reparație, Conformitate,
  Taxe → Comisioane, Diverse → Consumabile, Fonduri → Constituire fond); strategic = Proiect. Shown
  as a tag on every expanded row of the budget views. An unknown program stops the generator.
