#!/usr/bin/env python3
"""Generate data/Kralik/penalty-buckets-2026-05.json from the vendor's per-bucket sheets.

Reads the association's xlsx (`1B - MAI` / `11 - MAI`), which carry the vendor's authoritative
penalty buckets: per row scadenta, Zile overdue, penalizable Restanta, Procent, and the
`Penalizari corect` May column. We import those buckets exactly, keeping only rate>0 & restanta>0
(0-rate buckets never accrue). Each bucket's carried accrued-through-April is
    seedAccrued = restanta * rate * (zile - MAY_DAYS)
and the May charge our engine reproduces is restanta * rate * MAY_DAYS (afisare-delta window).
The seed script (seed-kralik-april-may.ts) reads this file to create PenaltyBucket rows.
"""
import openpyxl, datetime, json, os

XLSX = os.environ.get('KRALIK_XLSX',
    '/home/bogdan/property/data/kralik/may/Gh Lazar 4 - Date Istorice - 202615.xlsx')
OUT = os.path.join(os.path.dirname(__file__), 'penalty-buckets-2026-05.json')
MAY_DAYS = 32  # afisare-to-afisare window for 2026-05 (top of each sheet)

# vendor sheet -> (unit code as keyed in ledger-2026-04.json, restanta col, May-penalty col)
SHEETS = {
    '400191-C1-U28-AP 1/B': ('1B - MAI', 4, 9),   # MATEI: Restanta idx4, Penalizari corect idx9
    '400191-C1-U32-AP 11':  ('11 - MAI', 4, 6),   # MACRI: Bucket Restanta Penalizabil idx4, Penalizari (Curente) idx6
}

def n(v):
    return 0.0 if v in (None, '-', '') else (float(v) if isinstance(v, (int, float)) else 0.0)
def ds(d):
    return d.strftime('%Y-%m-%d') if isinstance(d, datetime.datetime) else str(d)

wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
out = {}
for unit, (sh, rc, pc) in SHEETS.items():
    rows = list(wb[sh].iter_rows(values_only=True))
    buckets = []
    for r in rows[2:]:
        if r[0] in (None, ''):
            continue
        month = r[1].strftime('%Y-%m') if isinstance(r[1], datetime.datetime) else str(r[1])
        scad = r[2]; zile = n(r[3]); rest = n(r[rc]); pcur = n(r[pc])
        rate = (pcur / (rest * MAY_DAYS)) if (rest > 0 and pcur > 0) else n(r[5])
        if rate <= 0 or rest <= 0:      # skip 0-rate / empty buckets
            continue
        seed = rest * rate * (zile - MAY_DAYS)
        buckets.append({
            'originMonth': month,
            'scadenta': ds(scad),
            'zile': int(zile),
            'restanta': round(rest, 2),
            'rate': round(rate, 8),          # fraction/day (0.0002 = 0.02%/day)
            'seedAccrued': round(seed, 2),   # accumulated penalty through April afisare
            'mayCharge': round(rest * rate * MAY_DAYS, 2),  # what the engine reproduces for May
        })
    out[unit] = {
        'buckets': buckets,
        'count': len(buckets),
        'seedAccruedTotal': round(sum(b['seedAccrued'] for b in buckets), 2),
        'mayChargeTotal': round(sum(b['mayCharge'] for b in buckets), 2),
    }

json.dump(out, open(OUT, 'w'), indent=2, ensure_ascii=False)
for unit, d in out.items():
    print(f"{unit}: {d['count']} buckets  seedAccrued={d['seedAccruedTotal']}  May={d['mayChargeTotal']}")
print('wrote', OUT)
