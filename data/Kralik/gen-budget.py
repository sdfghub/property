#!/usr/bin/env python3
"""Kralik budget workbook -> data/Kralik/budget-<year>.json (input of `npm run import:budget`).

Usage:  python3 gen-budget.py "<path>/Kralik - Buget - 2026.xlsx" 2026 > budget-2026.json   (needs openpyxl)

Sheets read (docs/budget.md):
  - Structura buget     service catalogue: Categorie -> Domeniu -> Serviciu
  - Proiect - Serviciu  how each project / maintenance item splits over services (weights, normalised)
  - Portofoliu          programs and projects/items: fund, vote year, duration, budget RON/EUR,
                        amount per year (the fiscal year's column is the annual budget)
  - Contract-Factura    strategic evidence: Bugetat (estimate), Datorat (commitment), Platit (payment)

The workbook is the source for budget amounts; this file only adds what the workbook can't say:
which app expense types carry each operational line's actuals, the app fund behind each workbook
fund label, and the link to the evaluated services (service_item).
"""
import json
import re
import sys
import unicodedata
from collections import OrderedDict

import openpyxl


def clean(v) -> str:
    return re.sub(r'\s+', ' ', str(v or '')).strip()


def key(v) -> str:
    s = unicodedata.normalize('NFKD', clean(v)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def slug(v) -> str:
    return key(v).upper().replace(' ', '_')


def num(v):
    if v is None or v == '':
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return 0.0


# ---- funds: workbook label -> app fund (Fund.code). appFund=False = planned, not yet set up. ----
FUNDS = OrderedDict([
    ('EXPENSES', {'label': 'Cheltuieli Întreținere', 'dimension': 'OPERATIONAL', 'appFund': True, 'aliases': ['intretinere']}),
    ('RULMENT', {'label': 'Fond Rulment', 'dimension': 'OPERATIONAL', 'appFund': True, 'aliases': ['rulment', 'fond rulment']}),
    ('CONSUMABILE', {'label': 'Consumabile', 'dimension': 'OPERATIONAL', 'appFund': False, 'aliases': ['consumabile']}),
    ('MENTENANTE', {'label': 'Fond Mentenanțe', 'dimension': 'TACTIC', 'appFund': False, 'aliases': ['mentenante']}),
    ('CONFORMITATE', {'label': 'Conformitate', 'dimension': 'TACTIC', 'appFund': False, 'aliases': ['conformitate']}),
    ('REPARATII', {'label': 'Fond Reparații', 'dimension': 'TACTIC', 'appFund': True, 'aliases': ['reparatii']}),
    ('REABILITARE_1', {'label': 'Fond Reabilitare 1', 'dimension': 'STRATEGIC', 'appFund': True,
                       'aliases': ['reabilitare 1', 'reablitare 1', 'fond proiect reabilitare']}),
    ('REABILITARE_2', {'label': 'Fond Reabilitare 2', 'dimension': 'STRATEGIC', 'appFund': True,
                       'aliases': ['reabilitare 2', 'fond pod fatada']}),
    ('REABILITARE_3', {'label': 'Fond Reabilitare 3', 'dimension': 'STRATEGIC', 'appFund': True,
                       'aliases': ['reabilitare 3', 'fond reabilitare 3']}),
    ('REABILITARE_4', {'label': 'Fond Reabilitare 4', 'dimension': 'STRATEGIC', 'appFund': False, 'aliases': ['reabilitare 4']}),
    ('REABILITARE_5', {'label': 'Fond Reabilitare 5', 'dimension': 'STRATEGIC', 'appFund': False, 'aliases': ['reabilitare 5']}),
])
# EUR/RON per year. Default = mean of the ECB daily reference rates in the year (= BNR yearly
# average to 3–4 decimals, via api.frankfurter.dev). A year listed in EUR_YEAR_FUND takes the rate
# of that fund in "Buget - Sumar" instead (Suma [RON] ÷ Suma [EUR]), so the fund's budget is exactly
# its EUR amount. Later years repeat the last known year. Rates edited in the app are kept on import.
EUR_RATES = OrderedDict([
    ('2022', {'rate': 4.9313, 'basis': 'medie anuală BCE (257 zile)'}),
    ('2023', {'rate': 4.9467, 'basis': 'medie anuală BCE (255 zile)'}),
    ('2024', {'rate': 4.9746, 'basis': 'medie anuală BCE (256 zile)'}),
    ('2025', {'rate': 5.0424, 'basis': 'medie anuală BCE (255 zile)'}),
    ('2026', {'rate': 5.2020, 'basis': 'medie BCE 02.01–12.11.2026 (222 zile)'}),
])
EUR_YEAR_FUND = {'2025': 'REABILITARE_2', '2026': 'REABILITARE_3'}


def fx_rates(years, wb, budget_items):
    out = {y: dict(v) for y, v in EUR_RATES.items()}
    fund_eur = {}
    if 'Buget - Sumar' in wb.sheetnames:
        for r in rows_of(wb['Buget - Sumar']):
            if len(r) > 21 and fund_of(r[18]) and num(r[19]) and num(r[21]):
                fund_eur[fund_of(r[18])] = (num(r[19]), num(r[21]))
    for y, code in EUR_YEAR_FUND.items():
        if code in fund_eur:
            _, eur = fund_eur[code]
            # The fund's budget that year in Portofoliu (what the app converts), not the sheet's RON.
            ron = round(sum(i['plan'].get(y, 0) for i in budget_items if i['fundCode'] == code), 2)
            out[y] = {'rate': round(ron / eur, 10), 'fromFund': {'code': code, 'ron': ron, 'eur': eur},
                      'basis': f'{FUNDS[code]["label"]} = {ron:,.2f} lei (Portofoliu {y}) = {eur:,.0f} € (Buget - Sumar)'.replace(',', '#').replace('.', ',').replace('#', '.')}
    last = max(out)
    for y in sorted(set(years)):
        if y not in out:
            out[y] = {'rate': out[last]['rate'], 'basis': f'ca în {last} (estimare)'}
    return dict(sorted(out.items()))


FUND_BY_ALIAS = {a: code for code, f in FUNDS.items() for a in f['aliases']}


def fund_of(label):
    k = key(label)
    return FUND_BY_ALIAS.get(k) if k else None


# ---- services: workbook names that differ between sheets -> one catalogue entry ----
SERVICE_ALIASES = {
    'salubritate': 'salubrizare', 'acces controlat': 'acces', 'siguranta': 'siguranta psi',
    'comisioane banca': 'comisioane bancare',
}
# Services used in "Proiect - Serviciu" but missing from "Structura buget".
EXTRA_SERVICES = [
    {'name': 'Supraveghere Video', 'category': 'Servicii Asociatie', 'domain': 'Securitate & Acces'},
    {'name': 'Internet', 'category': 'Servicii Asociatie', 'domain': 'Comunicatii'},
    {'name': 'Financiar', 'category': 'Servicii Asociatie', 'domain': 'Administrativ'},
]
# Workbook rows that are not services ("Alte Cheltuieli" in Structura buget): never catalogued.
SERVICE_SKIP = {'alte cheltuieli'}
# "Cladire" in the workbook is the building as a whole; the catalogue has three services for it.
# Its costs go 50/50 to Estetică and Funcționalitate; the basement works of the rehab programme
# (Contract-Factura "Arie" below, compared with key()) go to Siguranță (code STRUCTURA).
BUILDING_SERVICES = [('ESTETICA', 'Estetică'), ('FUNCTIONALITATE', 'Funcționalitate'), ('STRUCTURA', 'Siguranță')]
BUILDING_SPLIT = [('ESTETICA', 0.5), ('FUNCTIONALITATE', 0.5)]
STRUCTURE_AREAS = {'6 subsol'}
# Whole projects that belong to Siguranță clădire (Portofoliu project name, compared with key()).
STRUCTURE_PROJECTS = {'evaluare structurala testare materiale'}
# Catalogue corrections over the workbook (name / domain), keyed like SERVICE_ALIASES.
SERVICE_OVERRIDES = {
    'cladire': {'name': 'Intretinere Cladire', 'domain': 'Cladire'},
}
# Reference code in the model's catalogue (S01–S12) and the evaluated service it is scored by.
SPEC = {
    'apa rece': ('S05-01', ('Apă', 'Apă rece')), 'apa calda': ('S05-01', ('Apă', 'Apă caldă')),
    'canalizare': ('S05-02', ('Apă', 'Canalizare')), 'apa meteo': ('S05-03', ('Apă', 'Ape pluviale')),
    'energie termica': ('S05-05', ('Energie', 'Energie termică')), 'energie electrica': ('S05-04', ('Energie', 'Energie electrică')),
    'siguranta psi': ('S02-01', ('Siguranță', 'Protecția și stingerea incendiilor')), 'siguranta prevenier inundatii': ('S02-04', ('Siguranță', 'Prevenire inundații')),
    'iluminat': ('S03-01', ('Iluminat', 'Iluminat spații comune')),
    'interfon': ('S01-01', ('Securitate & Acces', 'Interfon')), 'acces': ('S01-01', ('Securitate & Acces', 'Acces controlat')),
    'supraveghere video': ('S01-03', ('Securitate & Acces', 'Supraveghere video')),
    'lift': ('S07-01', ('Mobilitate', 'Lift')), 'incalzire': ('S04-01', ('Încălzire, Răcire & Ventilație', 'Încălzire')),
    'racire': ('S04-02', ('Încălzire, Răcire & Ventilație', 'Răcire')),
    'ventilatie': ('S04-03', ('Încălzire, Răcire & Ventilație', 'Ventilație')),
    'curatenie': ('S06-01', ('Igienă & Îngrijire', 'Curățenie')), 'salubrizare': ('S06-02', ('Igienă & Îngrijire', 'Salubritate')),
    'ddd': ('S06-03', ('Igienă & Îngrijire', 'Dezinsecție, dezinfecție și deratizare')), 'intretinere spatii verzi': ('S06-04', ('Igienă & Îngrijire', 'Spații verzi')),
    'cladire': ('S08-01', ('Clădire', 'Siguranță')),
    'administrare': ('S10-01', ('Administrativ', 'Administrare')), 'comisioane bancare': ('S10-01', ('Administrativ', 'Bancar')),
    'juridic': ('S10-02', ('Administrativ', 'Juridic')), 'financiar': (None, ('Administrativ', 'Financiar')),
    'internet': ('S09-01', ('Comunicații', 'Internet')),
}
# Every budget service has a catalogue (evaluated) service: the services dashboard, the avizier and
# the budget share one list and one order. Missing catalogue entries are created by the import.

# ---- Portofoliu program -> managerial dimension (+ maintenance kind for TACTIC) ----
PROGRAM_DIMENSION = [
    ('investitii', ('STRATEGIC', None)),
    ('mentenante proactive', ('TACTIC', 'PREVENTIVE')),
    ('conformitate', ('TACTIC', 'PREVENTIVE')),
    ('mentenante reactive', ('TACTIC', 'REACTIVE')),
]

# ---- Portofoliu program -> cost type of its lines (labels in budget-meta.ts BUDGET_COST_TYPE_META) ----
PROGRAM_COST_TYPE = [
    ('utilitati', 'CONSUMPTION'), ('servicii furnizor', 'SUBSCRIPTION'), ('mentenante proactive', 'PREVENTIVE_MAINTENANCE'),
    ('mentenante reactive', 'REPAIR'), ('conformitate', 'COMPLIANCE'), ('taxe', 'FEES'), ('diverse', 'SUPPLIES'),
    ('fonduri', 'FUND'),
]


def cost_type_of(program):
    k = key(program)
    hit = next((v for p, v in PROGRAM_COST_TYPE if k.startswith(p) or p in k), None)
    if hit is None:
        raise SystemExit(f'Program "{program}" has no cost type: add it to PROGRAM_COST_TYPE')
    return hit


# ---- operational / tactic item -> app expense types that carry its actuals (live from the avizier) ----
EXPENSE_TYPES = {
    'curatenie': ['CURATENIE'], 'administrare': ['ADMINISTRARE'], 'salubritate': ['SALUBRITATE'],
    'iluminat': ['CURENT_SCARA'], 'apa rece': ['APA_RECE', 'APA_RECE_DIF', 'PENALITATI_APA'],
    'canalizare': ['CANALIZARE'], 'apa meteo': ['APA_METEO'], 'comisioane banca': ['COMISION_BANCA'],
    'mentenanta interfon': ['INTERFON'],
}
ITEM_SERVICE = {  # operational items not in "Proiect - Serviciu"
    'curatenie': 'curatenie', 'administrare': 'administrare', 'salubritate': 'salubrizare', 'ddd': 'ddd',
    'iluminat': 'iluminat', 'apa rece': 'apa rece', 'canalizare': 'canalizare', 'apa meteo': 'apa meteo',
    'comisioane banca': 'comisioane bancare',
    # Consumables: split evenly over the services the row names (bulbs, flower pots, paper, decorations).
    'becuri ghivece flori hartie decoratiuni etc': [('iluminat', 0.25), ('intretinere spatii verzi', 0.25), ('administrare', 0.25), ('cladire', 0.25)],
}
# Display names for workbook rows written as abbreviations.
LINE_NAMES = {'ddd': 'Dezinsecție, dezinfecție și deratizare'}
# Costs the app bills that the workbook has no line for — kept so their actuals are not lost.
APP_ONLY_LINES = [
    {'name': 'Demontare aparate de climatizare (intervenție)', 'program': 'Mentenante Reactive (Reparatii)',
     'dimension': 'TACTIC', 'maintenanceKind': 'REACTIVE', 'fundCode': 'EXPENSES', 'services': [('racire', 1)],
     'expenseTypes': ['DEMONTARE_CLIMA'], 'forecastMethod': 'NONE',
     'assumption': 'Nu figurează în Portofoliu; cost facturat prin avizier în 2026 (nebugetat).'},
    # Working-capital fund: not in the workbook; budgeted at the fund's target in the app, actual =
    # every RULMENT charge on the avizier.
    {'name': 'Fond de rulment – constituire', 'program': 'Fonduri operaționale', 'dimension': 'OPERATIONAL',
     'fundCode': 'RULMENT', 'services': [('financiar', 1)], 'actualFund': 'RULMENT', 'budgetFromFundTarget': True,
     'forecastMethod': 'BUDGET', 'assumption': 'Nu figurează în Portofoliu; bugetul anual = ținta fondului de rulment din aplicație.'},
]

# Contract-Factura rows of the rehab programme are filed by phase ("3. …") and Categorie;
# Instalatii / Constructie - Specialitati are separate projects in Portofoliu.
PROJECT_BY_CATEGORY = {'instalatii': 'reabilitare instalatii', 'constructie specialitati': 'reabilitare constructie specialitati'}


def parse_date(v, year):
    """dd.mm.yyyy -> (iso, note). Years after the fiscal year in Contract-Factura are fill-down typos."""
    if v is None or v == '':
        return None, None
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m-%d'), None
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})', str(v).strip())
    if not m:
        return None, None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    note = None
    if y > year:
        note = f'Data din registru {d:02d}.{mo:02d}.{y} corectată la {year} (eroare de completare în Excel).'
        y = year
    return f'{y}-{mo:02d}-{d:02d}', note


def rows_of(ws):
    return [r for r in ws.iter_rows(values_only=True)]


def main(path, year):
    wb = openpyxl.load_workbook(path, data_only=True)

    # ---------- services ----------
    services = OrderedDict()

    def add_service(name, category, domain):
        k = SERVICE_ALIASES.get(key(name), key(name))
        if k in services or k in SERVICE_SKIP:
            return
        spec, item = SPEC.get(k, (None, None))
        ov = SERVICE_OVERRIDES.get(k, {})
        name, domain = ov.get('name', name), ov.get('domain', domain)
        services[k] = {'code': slug(k), 'name': clean(name), 'category': clean(category), 'domain': clean(domain),
                       'specCode': spec, 'serviceItem': {'domain': item[0], 'name': item[1]} if item else None}

    for r in rows_of(wb['Structura buget']):
        if len(r) > 5 and clean(r[2]) == 'Cheltuieli' and clean(r[5]):
            add_service(r[5], r[3], r[4])
    for s in EXTRA_SERVICES:
        add_service(s['name'], s['category'], s['domain'])

    def svc(name):
        k = SERVICE_ALIASES.get(key(name), key(name))
        if k not in services:
            raise SystemExit(f'Unknown service: {name}')
        return services[k]['code']

    # ---------- Proiect - Serviciu ----------
    ps = rows_of(wb['Proiect - Serviciu'])
    cols = [clean(c) for c in ps[0]]
    split_of = {}
    for r in ps[1:]:
        if not clean(r[0]):
            continue
        cells = [(cols[i], num(v)) for i, v in enumerate(r) if i > 0 and v is not None and str(v).strip() != '']
        total = sum(w for _, w in cells)
        if not cells:
            continue
        # All-zero rows (a service named but not weighted yet) split equally among the named services.
        weights = [(svc(n), (w / total) if total else 1 / len(cells)) for n, w in cells]
        split_of[key(r[0])] = {'split': [{'code': c, 'weight': round(w, 6)} for c, w in weights],
                               'raw': {n: w for n, w in cells}, 'normalised': abs(total - 1) > 1e-9}

    # ---------- Portofoliu ----------
    pf = rows_of(wb['Portofoliu'])
    hdr = pf[0]
    year_col = {int(h): i for i, h in enumerate(hdr) if isinstance(h, (int, float))}
    col = {clean(h): i for i, h in enumerate(hdr) if isinstance(h, str)}
    programs = OrderedDict()
    projects, lines = [], []
    for n, r in enumerate(pf[1:], start=2):
        g = lambda k: r[col[k]] if col[k] < len(r) else None
        prog = clean(g('Program'))
        if not prog:
            continue
        dim, mk = next((v for p, v in PROGRAM_DIMENSION if key(prog).startswith(p) or p in key(prog)), ('OPERATIONAL', None))
        if prog not in programs:
            programs[prog] = {'code': f'PGM-{len(programs) + 1:03d}', 'name': prog, 'dimension': dim, 'sortOrder': len(programs)}
        name = clean(g('Proiect')) or clean(g('Scop'))
        years = {y: round(num(r[i]), 2) for y, i in year_col.items() if i < len(r) and num(r[i])}
        fund_label = clean(g('Fond'))
        fund = fund_of(fund_label)
        if fund_label and not fund:
            raise SystemExit(f'Unknown fund label in Portofoliu row {n}: {fund_label}')
        sp = split_of.get(key(name))
        if dim == 'STRATEGIC':
            projects.append({
                'code': f'PRJ-{len(projects) + 1:03d}', 'programCode': programs[prog]['code'], 'name': name,
                'scope': clean(g('Scop')) or None, 'fundCode': fund, 'fundLabel': fund_label or None,
                'voteYear': int(num(g('Vot'))) or None, 'durationYears': int(num(g('Ani'))) or None,
                'budgetAmount': round(num(g('Buget [RON]')), 2) or None, 'budgetEur': round(num(g('Buget [EUR]')), 2) or None,
                'yearPlan': {str(y): v for y, v in sorted(years.items())},
                'serviceSplit': sp['split'] if sp else [{'code': svc('cladire'), 'weight': 1}],
                'serviceSplitNote': None if sp else 'Proiectul nu apare în „Proiect - Serviciu”; atribuit Clădirii (50% Estetică, 50% Funcționalitate).',
                'sourceRow': n, 'key': key(name),
            })
            continue
        k = key(name)
        if not sp and k not in ITEM_SERVICE:
            raise SystemExit(f'Portofoliu row {n} "{name}" has no service: add it to "Proiect - Serviciu" or ITEM_SERVICE')
        target = ITEM_SERVICE.get(k)
        services_split = sp['split'] if sp else (
            [{'code': svc(t), 'weight': w} for t, w in target] if isinstance(target, list) else [{'code': svc(target), 'weight': 1}])
        lines.append({
            'program': prog, 'dimension': dim, 'maintenanceKind': mk, 'name': LINE_NAMES.get(k, name),
            'scope': clean(g('Scop')) or None, 'fundCode': fund, 'fundLabel': fund_label or None,
            'annual': years.get(year, 0.0), 'years': {str(y): v for y, v in sorted(years.items())},
            'serviceSplit': services_split, 'serviceSplitRaw': sp['raw'] if sp else None,
            'expenseTypes': EXPENSE_TYPES.get(k), 'sourceRow': n,
        })
    for x in APP_ONLY_LINES:
        if x['program'] not in programs:
            programs[x['program']] = {'code': f'PGM-{len(programs) + 1:03d}', 'name': x['program'], 'dimension': x['dimension'], 'sortOrder': len(programs)}
        lines.append({**{k: v for k, v in x.items() if k != 'services'}, 'annual': 0.0, 'years': {},
                      'serviceSplit': [{'code': svc(s), 'weight': w} for s, w in x['services']], 'appOnly': not x.get('budgetFromFundTarget')})
    for i, l in enumerate(lines, start=1):
        l['costType'] = cost_type_of(l['program'])
        l['code'] = f"BUG-{'OPE' if l['dimension'] == 'OPERATIONAL' else 'TAC'}-{i:03d}"
        l['programCode'] = programs[l['program']]['code']

    # ---------- Contract-Factura -> strategic evidence lines ----------
    # Contract-Factura names phases "1. Proiectare & …" where Portofoliu says "1. Reabilitare - Proiectare & …":
    # numbered projects match on their number.
    by_key = {p['key']: p for p in projects}
    by_num = {p['key'].split(' ', 1)[0]: p for p in projects if p['key'][:1].isdigit()}

    def project_named(name):
        k = key(name)
        return by_key.get(k) or (by_num.get(k.split(' ', 1)[0]) if k[:1].isdigit() else None)
    cf = rows_of(wb['Contract-Factura'])
    h = [clean(x) for x in cf[0]]
    ix = {x: i for i, x in enumerate(h)}
    evid = OrderedDict()
    for n, r in enumerate(cf[1:], start=2):
        g = lambda k: r[ix[k]] if k in ix and ix[k] < len(r) else None
        cat, area = clean(g('Categorie')), clean(g('Arie')) or '(fără arie)'
        proj_name = clean(g('Proiect'))
        note_proj = None
        target = PROJECT_BY_CATEGORY.get(key(cat))
        if target:
            proj = by_key[target]
        elif proj_name:
            proj = project_named(proj_name)
        else:
            # "-1. Majorări": no project in the register; the addendum cites the roof and courtyard estimates.
            proj = project_named('2.')
            note_proj = 'Rândul nu are proiect în registru; atribuit proiectului 2 (actul adițional citează devizele pentru acoperiș și curte).'
        if proj is None:
            raise SystemExit(f'Contract-Factura row {n}: unknown project {proj_name!r}')
        vendor = clean(g('Furnizor')) or 'De stabilit'
        doc = clean(g('Document'))
        what = clean(g('Reprezinta'))
        lk = (proj['code'], area, vendor, doc or what)
        line = evid.get(lk)
        if line is None:
            line = evid[lk] = {'projectCode': proj['code'], 'category': cat or None, 'area': area, 'vendor': vendor,
                               'document': doc or None, 'name': ' – '.join(x for x in [vendor, doc or what] if x) or area,
                               'serviceSplit': proj['serviceSplit'], 'entries': []}
        inclus = clean(g('Bugetat - inclus')).lower() or None
        fund_label = clean(g('Fond'))
        fund = fund_of(fund_label) if fund_label not in ('', '—') else None
        date, date_note = parse_date(g('Data'), year)
        inv = clean(g('Factura'))
        common = {'sourceRow': n, 'description': what or doc or None, 'documentRef': inv if inv not in ('', '—') else None,
                  'note': ' '.join(x for x in [clean(g('Observatii & Comentarii')), date_note or '', note_proj or ''] if x) or None}
        bug, dat, pl = num(g('Bugetat')), num(g('Datorat')), num(g('Platit'))
        if bug:
            line['entries'].append(dict(common, documentRef=doc or None, kind='ESTIMATE', amount=round(bug, 2),
                                        inBaseline=inclus in ('da', 'na', 'personal'), baselineFlag=inclus))
        if dat:
            line['entries'].append(dict(common, kind='COMMITMENT', amount=round(dat, 2), documentRef=doc or common['documentRef']))
        if pl:
            line['entries'].append(dict(common, kind='PAYMENT', amount=round(abs(pl), 2), date=date, fundCode=fund or proj['fundCode'],
                                        fundLabel=fund_label or None, fundInferred=not fund))
    strategic = []
    for i, l in enumerate([x for x in evid.values() if x['entries']], start=1):
        pay = {}
        for e in l['entries']:
            if e['kind'] == 'PAYMENT' and e.get('fundCode'):
                pay[e['fundCode']] = pay.get(e['fundCode'], 0) + e['amount']
        proj = next(p for p in projects if p['code'] == l['projectCode'])
        l['fundCode'] = max(pay, key=pay.get) if pay else proj['fundCode']
        l['code'] = f'BUG-STR-{i:03d}'
        strategic.append(l)

    # ---- Clădire in the workbook → the catalogue's Estetică / Funcționalitate (50/50); the basement of
    # the rehab programme (Contract-Factura areas in STRUCTURE_AREAS) → Siguranță ----
    def forecast_of(l):
        s_ = lambda k: sum(e['amount'] for e in l['entries'] if e['kind'] == k)
        return max(s_('ESTIMATE'), s_('COMMITMENT'), s_('PAYMENT'))

    def resplit(split, structure_share=0.0):
        out_ = []
        for x in split:
            if x['code'] != services['cladire']['code']:
                out_.append(dict(x))
                continue
            w = x['weight']
            parts = ([('STRUCTURA', w * structure_share)] if structure_share else []) + \
                [(c, w * (1 - structure_share) * share) for c, share in BUILDING_SPLIT]
            out_ += [{'code': c, 'weight': round(v, 6)} for c, v in parts]
        drift = round(1 - sum(x['weight'] for x in out_), 6)  # rounding: keep the weights summing to 1
        if out_ and drift:
            out_[-1]['weight'] = round(out_[-1]['weight'] + drift, 6)
        return out_

    for p in projects:
        if key(p['name']) in STRUCTURE_PROJECTS:
            p['serviceSplit'] = [{'code': 'STRUCTURA', 'weight': 1}]
            p['serviceSplitNote'] = 'Proiect de siguranță a clădirii (structură): atribuit integral serviciului Siguranță.'
            for l in strategic:
                if l['projectCode'] == p['code']:
                    l['serviceSplit'] = [{'code': 'STRUCTURA', 'weight': 1}]
            continue
        own = [l for l in strategic if l['projectCode'] == p['code']]
        total = sum(forecast_of(l) for l in own)
        base = sum(forecast_of(l) for l in own if key(l['area']) in STRUCTURE_AREAS)
        share = base / total if total else 0.0
        p['serviceSplit'] = resplit(p['serviceSplit'], share)
        if share:
            ro = lambda v, d=0: f'{v:,.{d}f}'.replace(',', ' ').replace('.', ',').replace(' ', '.')
            p['serviceSplitNote'] = (f'Clădire: Siguranță {ro(share * 100, 2)}% (lucrările la subsol: {ro(base)} din {ro(total)} lei prevăzuți '
                                     f'în Contract-Factura); restul, în părți egale, Estetică și Funcționalitate.')
    for l in strategic:
        if l['serviceSplit'] == [{'code': 'STRUCTURA', 'weight': 1}]:
            continue
        l['serviceSplit'] = [{'code': 'STRUCTURA', 'weight': 1}] if key(l['area']) in STRUCTURE_AREAS else resplit(l['serviceSplit'])
    for l in lines:
        l['serviceSplit'] = resplit(l['serviceSplit'])
    # The catalogue entry "Cladire" becomes its three catalogue services, in its place.
    building = services['cladire']
    services = dict(sum(([(k, v)] if k != 'cladire' else [
        (c.lower(), {**building, 'code': c, 'name': n, 'serviceItem': {'domain': 'Clădire', 'name': n}})
        for c, n in BUILDING_SERVICES] for k, v in services.items()), []))

    for p in projects:
        p.pop('key', None)
    out = {
        'source': path.rsplit('/', 1)[-1],
        'version': {'code': f'BUG-{year}', 'name': f'Buget {year} – servicii, fonduri, proiecte', 'fiscalYear': year,
                    'status': 'DRAFT', 'baselineYear': year - 1,
                    'notes': f'Din „{path.rsplit("/", 1)[-1]}”: Portofoliu (coloana {year} = bugetul anual; proiecte multianuale cu tranșe pe ani), '
                             'Proiect - Serviciu (împărțirea pe servicii), Structura buget (catalogul de servicii), Contract-Factura (angajamente și plăți).'},
        'fxRates': fx_rates([str(y) for y in year_col], wb,
                            [{'fundCode': p['fundCode'], 'plan': p['yearPlan']} for p in projects]
                            + [{'fundCode': l['fundCode'], 'plan': l['years']} for l in lines]),
        'funds': [{'code': c, 'label': f['label'], 'dimension': f['dimension'], 'appFund': f['appFund']} for c, f in FUNDS.items()],
        'services': [dict(s, sortOrder=i) for i, s in enumerate(services.values())],
        'programs': list(programs.values()),
        'projects': projects,
        'lines': lines,
        'strategic': strategic,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
