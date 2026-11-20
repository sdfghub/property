#!/usr/bin/env python3
"""Extract the Kralik rehabilitation programme (FM-STR) from the project-plan workbook.

Usage:  python3 gen-budget-rehab.py "<path>/Kralik - Project Plan - v0.7.xlsx" > budget-rehab.json

Reads the `Contract-Factura` sheet only (one row per contract / invoice / payment). Rows are
grouped into budget lines by (Categorie, Arie, Furnizor, Document); every row becomes one
evidence entry on its line:
  - Bugetat  -> ESTIMATE  (counts in the approved budget only when "Bugetat - inclus" is da/NA/personal)
  - Datorat  -> COMMITMENT (contract / act adițional / deviz value)
  - Platit   -> PAYMENT    (cash out; negative in the sheet, stored positive)
The sheet's "Fond" column names the source fund; it is mapped to the app's fund codes below.
"""
import json
import re
import sys
from collections import OrderedDict

import openpyxl

FUND_BY_LABEL = {
    'fond proiect + reabilitare': 'REABILITARE_1',
    'fond pod + fațadă': 'REABILITARE_2',
    'fond pod + fatada': 'REABILITARE_2',
    'fond reabilitare 3': 'REABILITARE_3',
}

PROJECTS = OrderedDict([
    ('Constructie - General', {'code': 'PRJ-001', 'name': 'Reabilitare – Construcție general'}),
    ('Instalatii', {'code': 'PRJ-002', 'name': 'Reabilitare – Instalații'}),
    ('Constructie - Specialitati', {'code': 'PRJ-003', 'name': 'Reabilitare – Construcție specialități'}),
])

# Work area -> service catalogue code (model de bugetare §4–5)
SERVICE_BY_AREA = {
    '0.1': 'S10-02', '0.2': 'S10-02', '-1': 'S08-01',
    '1.': 'S08-02', '2.': 'S08-02', '3.': 'S08-01', '4.': 'S08-02', '5.': 'S08-03', '6.': 'S08-01',
    '7.1': 'S08-03', '7.2': 'S08-03', '7.3': 'S05-03', '7.4': 'S08-02',
    '8.1': 'S05-04', '8.2': 'S01-01', '8.3': 'S09-01', '8.4': 'S05-06', '8.5': 'S04-02', '8.6': 'S04-01',
}


def service_for(area: str) -> str:
    for prefix in sorted(SERVICE_BY_AREA, key=len, reverse=True):
        if area.startswith(prefix):
            return SERVICE_BY_AREA[prefix]
    return 'S08-01'


def num(v):
    if v is None or v == '':
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(',', '.'))
    except ValueError:
        return 0.0


def clean(v) -> str:
    return re.sub(r'\s+', ' ', str(v or '')).strip()


def parse_date(v):
    """dd.mm.yyyy -> (iso, note). Years after 2026 in this sheet are fill-down typos (the row's
    own order puts them in 2026) — corrected and flagged, never silently."""
    if v is None or v == '':
        return None, None
    if hasattr(v, 'strftime'):
        return v.strftime('%Y-%m-%d'), None
    m = re.match(r'^(\d{1,2})\.(\d{1,2})\.(\d{4})', str(v).strip())
    if not m:
        return None, None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    note = None
    if y > 2026:
        note = f'Data din registru {d:02d}.{mo:02d}.{y} corectată la 2026 (eroare de completare în Excel).'
        y = 2026
    return f'{y}-{mo:02d}-{d:02d}', note


def main(path: str):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['Contract-Factura']
    rows = list(ws.iter_rows(values_only=True))
    header = [clean(h) for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}

    lines = OrderedDict()
    for n, r in enumerate(rows[1:], start=2):
        get = lambda k: r[idx[k]] if k in idx and idx[k] < len(r) else None
        cat = clean(get('Categorie'))
        if cat not in PROJECTS:
            continue
        area = clean(get('Arie')) or '(fără arie)'
        vendor = clean(get('Furnizor')) or 'De stabilit'
        doc = clean(get('Document'))
        what = clean(get('Reprezinta'))
        key = (cat, area, vendor, doc or what)
        line = lines.get(key)
        if line is None:
            line = lines[key] = {
                'projectCode': PROJECTS[cat]['code'],
                'area': area,
                'serviceCode': service_for(area),
                'vendor': vendor,
                'document': doc or None,
                'name': ' – '.join(x for x in [vendor, doc or what] if x) or area,
                'entries': [],
            }
        inclus = clean(get('Bugetat - inclus')).lower() or None
        fund_label = clean(get('Fond'))
        fund = FUND_BY_LABEL.get(fund_label.lower()) if fund_label and fund_label != '—' else None
        date, date_note = parse_date(get('Data'))
        common = {
            'sourceRow': n,
            'description': what or doc or None,
            'documentRef': clean(get('Factura')) if clean(get('Factura')) not in ('', '—') else None,
            'note': ' '.join(x for x in [clean(get('Observatii & Comentarii')), date_note or ''] if x) or None,
        }
        bug, dat, pl = num(get('Bugetat')), num(get('Datorat')), num(get('Platit'))
        if bug:
            common_b = dict(common, documentRef=doc or None)
            line['entries'].append(dict(common_b, kind='ESTIMATE', amount=round(bug, 2), inBaseline=inclus in ('da', 'na', 'personal'), baselineFlag=inclus))
        if dat:
            line['entries'].append(dict(common, kind='COMMITMENT', amount=round(dat, 2), documentRef=doc or common['documentRef']))
        if pl:
            line['entries'].append(dict(common, kind='PAYMENT', amount=round(abs(pl), 2), date=date, fundCode=fund, fundLabel=fund_label or None))
        elif fund and not line.get('fundCode'):
            line['fundCode'] = fund

    out_lines = []
    for i, line in enumerate(lines.values(), start=1):
        if not line['entries']:
            continue
        pay_funds = {}
        for e in line['entries']:
            if e['kind'] == 'PAYMENT' and e.get('fundCode'):
                pay_funds[e['fundCode']] = pay_funds.get(e['fundCode'], 0) + e['amount']
        if pay_funds:
            line['fundCode'] = max(pay_funds, key=pay_funds.get)
        line['code'] = f'BUG-STR-{i:03d}'
        out_lines.append(line)

    json.dump({
        'source': 'Kralik - Project Plan - v0.7.xlsx / Contract-Factura',
        'program': {'code': 'PGM-001', 'name': 'Program de reabilitare Palatul Kralik',
                    'objective': 'Reabilitarea și punerea în siguranță a imobilului (acoperiș, curte interioară, calcane, fațade, scări, subsol, instalații).'},
        'projects': [dict(v, category=k) for k, v in PROJECTS.items()],
        'lines': out_lines,
    }, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1])
