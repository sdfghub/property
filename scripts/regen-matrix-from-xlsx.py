#!/usr/bin/env python3
"""
Regenerate data/Kralik/history/matrix.csv from a "Date Istorice" xlsx export.

    python3 scripts/regen-matrix-from-xlsx.py "<path-to.xlsx>" [outfile]

The xlsx "Data" sheet has the same wide layout as matrix.csv
(Luna, Categorie, Serviciu-Grup, Serviciu, Stare, Stare-Operational, Cheltuiala, <32 unit cols>, Total)
but carries duplicate-/helper-labelled rows the parser (which keys on the Cheltuiala column and
ignores Stare) would double-count. We emit exactly ONE canonical row per (month, Cheltuiala):

  · drop  Stare == 'Checksum'      (spreadsheet checksums)
  · drop  Stare == 'Neachitat'     (REAB_3 total-unpaid; the arrears row is 'Restante')
  · for 'FOND PROIECT+REABILITARE-Restanțe', prefer 'Restante-Afisat' over 'Restante'
    (only 2026-03 carries both; the -Afisat value is the consistent one in the Feb→Apr chain)

Only the months already present in the current matrix.csv are emitted, so the injected timeline
is unchanged. This newer export adds the REABILITARE_3 arrears ('Fond Reabilitare 3-Restante')
the old export lacked — map it in history-mapping.json:
    "Fond Reabilitare 3-Restante": { "kind": "balance", "role": "arrears", "fund": "REABILITARE_3" }
"""
import openpyxl, datetime, csv, sys, os

MN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(ROOT, 'data/Kralik/history/matrix.csv')

def luna_of(v):
    return f"{MN[v.month-1].capitalize()}-{str(v.year)[2:]}"

def main():
    xlsx = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else OLD
    with open(OLD, newline='') as f:
        r = csv.reader(f); hdr = next(r)
        oldmonths = {row[0] for row in r if row and row[0]}
    ws = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)["Data"]
    rows = list(ws.iter_rows(min_row=1, values_only=True))

    chosen, order, seen = {}, [], set()
    for row in rows:
        v = row[0]
        if not isinstance(v, datetime.datetime):
            continue
        luna = luna_of(v)
        if luna not in oldmonths or row[6] is None:
            continue
        stare = str(row[4])
        if stare in ('Checksum', 'Neachitat'):
            continue
        k = (luna, str(row[6]))
        if k not in chosen or stare == 'Restante-Afisat':
            chosen[k] = row
        if k not in seen:
            seen.add(k); order.append(k)

    seq = lambda m: (2000 + int(m.split('-')[1])) * 12 + MN.index(m.split('-')[0].lower())
    with open(out, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(hdr)
        for k in sorted(order, key=lambda x: seq(x[0])):
            vals = list(chosen[k])[:len(hdr)]
            vals[0] = k[0]
            w.writerow(['' if c is None else (k[0] if isinstance(c, datetime.datetime) else c) for c in vals])
    print(f"wrote {out}: {len(order)} rows, {len({k[0] for k in order})} months")

if __name__ == '__main__':
    main()
