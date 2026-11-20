#!/usr/bin/env python3
"""
Budget workbook in the association's classic layout ("Buget <an>" sheet: Nr crt / Capitol /
Denumire / Status / Furnizor / Fond / 12 months / SIM / Total / T1–T4 / ... / Comentarii),
grouped Operațional → Tactic (preventiv, reactiv) → Strategic (program → proiecte), plus the
fund section.

    npx ts-node --transpile-only src/scripts/export-budget-json.ts Kralik /tmp/b.json
    python3 scripts/budget_to_xlsx.py /tmp/b.json "out.xlsx"

Sheets:
  <an>-Buget   approved budget, phased by month (Strategic: project baseline, not phased)
  <an>-Exec    Actual (closed months / dated payments) + Forecast for the remaining months,
               compared with the budget (Buget vs Forecast vs Actual)
  <an>-Sumar   rollup per dimension / project and per fund, linked to the two sheets
All totals are Excel formulas; month values are the numbers computed by the app.
"""
import json
import sys
from collections import defaultdict

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L

MONTHS_RO = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August',
             'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie']
FONT = 'Arial'
HEAD_FILL = PatternFill('solid', fgColor='EAF1DD')   # header + subtotals (reference look)
SECT_FILL = PatternFill('solid', fgColor='DAEEF3')   # section rows (I. VENITURI, II. CHELTUIELI)
GRP_FILL = PatternFill('solid', fgColor='F2F2F2')    # sub-group subtotals
TOTAL_FILL = PatternFill('solid', fgColor='FFFF00')  # grand totals
ACT_FILL = PatternFill('solid', fgColor='D9D9D9')    # closed months in the Exec sheet
DRAFT_FILL = PatternFill('solid', fgColor='FCE4D6')
thin = Side(style='thin', color='A6A6A6')
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
NUM = '#,##0;[Red]-#,##0;"-"'
RON = '#,##0 "RON";[Red]-#,##0 "RON";"-"'
PCT = '0%;[Red]-0%;"-"'

# column map
C_NR, C_CAP, C_NAME, C_STATUS, C_VENDOR, C_FUND = 1, 2, 3, 4, 5, 6
C_M0 = 7                      # G = Ianuarie ... R = Decembrie
C_SIM = C_M0 + 12             # S
C_TOT = C_SIM + 1             # T  Total an
C_Q0 = C_TOT + 1              # U..X  T1..T4
C_PRE = C_Q0 + 4              # Y  anterior / fără dată
C_REST = C_PRE + 1            # Z  nefazat
C_ALL = C_REST + 1            # AA total linie
C_CMP = C_ALL + 1             # AB comparație (Real an-1 | Buget)
C_DELTA = C_CMP + 1           # AC
C_DPCT = C_DELTA + 1          # AD
C_NOTE = C_DPCT + 1           # AE
LAST = C_NOTE
HEAD_ROW = 7
UNSPEC = '(fond nespecificat)'


def r2(x):
    return round((x or 0) + 0.0, 2)


def main(src, out, first_year=None):
    d = json.load(open(src))
    b = d['budget']
    ver = b['version']
    year = ver['fiscalYear']
    lines = d['lines']
    funds = {f['code']: f for f in d['funds']}
    fname = {c: f['name'] for c, f in funds.items()}
    comm = d['community']
    info = (comm.get('features') or {}).get('associationInfo') or {}
    order = ((info.get('fundConfig') or {}).get('order')) or list(funds)
    month_codes = [f'{year}-{m:02d}' for m in range(1, 13)]
    first_year = int(first_year) if first_year else year

    hist = defaultdict(float)          # (periodCode, expenseType) -> real cost (closed periods)
    for h in d.get('expenseHistory') or []:
        hist[(h['periodCode'], h['expenseType'])] += h['amount']
    fch = defaultdict(float)           # (fundCode, periodCode) -> contributions billed to units
    for h in d.get('fundCharges') or []:
        if h.get('periodStatus') == 'CLOSED':
            fch[(h['fundCode'], h['periodCode'])] += h['amount']

    # month kinds (from any live operational line)
    kinds = {}
    for x in lines:
        for m in x.get('months') or []:
            kinds.setdefault(m['periodCode'], m['kind'])

    kinds26 = dict(kinds)

    # ---- build the row model -------------------------------------------------------------
    def fund_label(code):
        return fname.get(code, code) if code else UNSPEC

    def note_for(x):
        line = x['line']
        basis = line.get('basis') or {}
        parts = []
        if line.get('assumption'):
            parts.append('Ipoteză: ' + line['assumption'])
        if basis.get('formula'):
            parts.append(basis['formula'])
        if line['dimension'] == 'STRATEGIC':
            met = x['metrics']
            excl = [i['value'] for i in basis.get('inputs', []) if str(i.get('label', '')).startswith('Estimări în afara')]
            parts.append(f"Angajat: {met.get('committed') or 0:,.2f}; Estimare: {met.get('estimate') or 0:,.2f}")
            if excl:
                parts.append('În afara bugetului: ' + str(excl[0]))
            if basis.get('source'):
                parts.append('Sursa: ' + basis['source'])
            notes = sorted({e['note'] for e in x['entries'] if e.get('note')})
            parts += notes
        elif basis.get('forecastFormula'):
            parts.append(basis['forecastFormula'])
        return ' | '.join(parts)

    def live_row(x, mode):
        """Operational / tactic lines (monthly)."""
        line, met = x['line'], x['metrics']
        basis = line.get('basis') or {}
        if mode == 'actual':
            codes = (line.get('actualSource') or {}).get('codes') or []
            months = [sum(hist.get((c, t), 0) for t in codes) for c in month_codes]
            prev = sum(hist.get((f'{year - 1}-{m:02d}', t), 0) for m in range(1, 13) for t in codes)
            note = (f"Real: cost repartizat în lunile închise din {year} (tipuri de cheltuială: {', '.join(codes)})." if codes
                    else f'Linie introdusă în bugetul {ver["fiscalYear"]}; fără cost înregistrat în {year}.')
            return dict(kind='line', code=line['code'], name=line['name'], status=line['statusLabel'],
                        vendor=line.get('vendorName') or '', fund=fund_label(line.get('fundCode')),
                        months=[r2(v) for v in months], pre=None, rest=None,
                        cmp=r2(prev) if codes else None, note=note, line=line)
        if x.get('months'):
            months = [m['budget'] if mode == 'buget' else m['forecast'] for m in x['months']]
        else:  # provision / to-confirm lines: phasing (budget) = forecast
            ph = line.get('phasing') or {}
            if not ph and basis.get('method') == 'FUND_CONTRIBUTION':
                ph = {i['label']: i['value'] for i in basis.get('inputs', [])}
            months = [ph.get(c, 0) or 0 for c in month_codes]
        rest = None
        if mode == 'exec' and not x.get('months'):
            # provision lines have no recorded cost: closed months show 0 actual; the unspent part of
            # those months stays in the forecast as "nefazat" (the app assumes the provision is used).
            unspent = sum(v for c, v in zip(month_codes, months) if kinds.get(c) == 'ACTUAL')
            months = [0 if kinds.get(c) == 'ACTUAL' else v for c, v in zip(month_codes, months)]
            rest = r2(unspent) or None
        prev = sum(i['value'] for i in basis.get('inputs', []) if isinstance(i.get('value'), (int, float))) \
            if basis.get('method') == 'HISTORICAL_SAME_MONTH' else None
        return dict(kind='line', code=line['code'], name=line['name'], status=line['statusLabel'],
                    vendor=line.get('vendorName') or '', fund=fund_label(line.get('fundCode')),
                    months=[r2(v) for v in months], pre=None, rest=rest,
                    cmp=(r2(prev) if mode == 'buget' and prev is not None else (r2(met['budget']) if mode == 'exec' else None)),
                    note=note_for(x), line=line)

    def strategic_rows(x, mode):
        line, met = x['line'], x['metrics']
        main_fund = line.get('fundCode') or '_'
        pays = [e for e in x['entries'] if e['kind'] == 'PAYMENT']
        by_fund = defaultdict(lambda: {'pre': 0.0, 'm': [0.0] * 12})
        for e in pays:
            f = e.get('fundCode') or '_'
            dt = (e.get('date') or '')[:7]
            if dt in month_codes:
                by_fund[f]['m'][month_codes.index(dt)] += e['amount']
            else:
                by_fund[f]['pre'] += e['amount']
        base = dict(kind='line', code=line['code'], name=line['name'], status=line['statusLabel'],
                    vendor=line.get('vendorName') or '', note=note_for(x), line=line)
        if mode == 'actual':
            yr = str(year)
            dated = [e for e in pays if e.get('date') and e['date'][:4] <= yr]
            if not dated:
                return []
            by_fund = defaultdict(lambda: {'pre': 0.0, 'm': [0.0] * 12})
            for e in dated:
                f = e.get('fundCode') or '_'
                if e['date'][:4] == yr:
                    by_fund[f]['m'][int(e['date'][5:7]) - 1] += e['amount']
                else:
                    by_fund[f]['pre'] += e['amount']
            main = by_fund.pop(main_fund, {'pre': 0.0, 'm': [0.0] * 12})
            rows = [dict(base, fund=fund_label(line.get('fundCode')), months=[r2(v) for v in main['m']],
                         pre=r2(main['pre']), rest=None, cmp=None, subs=len(by_fund),
                         note=f"Plăți efectuate (registrul de plăți). Buget de bază linie: {met['budget']:,.2f}; forecast: {met['forecast']:,.2f}.")]
            for f, v in sorted(by_fund.items()):
                rows.append(dict(kind='sub', code='', name=f"   ↳ {line['name']} – plăți din {fund_label(None if f == '_' else f)}",
                                 status='', vendor='', fund=fund_label(None if f == '_' else f),
                                 months=[r2(m) for m in v['m']], pre=r2(v['pre']), rest=None, cmp=None,
                                 note='Aceeași linie, partea plătită din alt fond (registrul de plăți).'))
            return rows
        if mode == 'buget':
            return [dict(base, fund=fund_label(line.get('fundCode')), months=[None] * 12, pre=None,
                         rest=r2(met['budget']), cmp=None)]
        paid_total = sum(e['amount'] for e in pays)
        rest = r2(max(met['forecast'] - paid_total, 0))
        main = by_fund.pop(main_fund, {'pre': 0.0, 'm': [0.0] * 12})
        rows = [dict(base, fund=fund_label(line.get('fundCode')), months=[r2(v) for v in main['m']],
                     pre=r2(main['pre']), rest=rest, cmp=r2(met['budget']), subs=len(by_fund))]
        for f, v in sorted(by_fund.items()):
            rows.append(dict(kind='sub', code='', name=f"   ↳ {line['name']} – plăți din {fund_label(None if f == '_' else f)}",
                             status='', vendor='', fund=fund_label(None if f == '_' else f),
                             months=[r2(m) for m in v['m']], pre=r2(v['pre']), rest=0, cmp=None,
                             note='Aceeași linie, partea plătită din alt fond (registrul de plăți).'))
        return rows

    def groups(mode):
        dims = {dd['code']: dd for dd in b['dimensions']}
        by_code = {x['line']['code']: x for x in lines}
        out = []
        ope = [x for x in lines if x['line']['dimension'] == 'OPERATIONAL']
        out.append(dict(key='A', title=f"A. Cheltuieli operaționale ({dims['OPERATIONAL'].get('fm', 'FM-OPE')}) – {dims['OPERATIONAL'].get('hint', '')}",
                        children=[dict(key='A', title=None, rows=[live_row(x, mode) for x in ope])]))
        tac = [x for x in lines if x['line']['dimension'] == 'TACTIC']
        tch = []
        for i, (mk, lbl) in enumerate([('PREVENTIVE', 'Mentenanță preventivă'), ('REACTIVE', 'Mentenanță reactivă')], 1):
            rows = [live_row(x, mode) for x in tac if x['line']['maintenanceKind'] == mk]
            tch.append(dict(key=f'B.{i}', title=f'B.{i} {lbl}', rows=rows))
        out.append(dict(key='B', title=f"B. Cheltuieli tactice ({dims['TACTIC'].get('fm', 'FM-TAC')}) – {dims['TACTIC'].get('hint', '')}", children=tch))
        stra = [x for x in lines if x['line']['dimension'] == 'STRATEGIC']
        projs = []
        for x in stra:
            p = x['line']['project']
            if p and p['code'] not in [q['code'] for q in projs]:
                projs.append(p)
        projs.sort(key=lambda p: p['code'])
        prog = projs[0]['program']['name'] if projs else 'Program'
        sch = []
        for i, p in enumerate(projs, 1):
            rows = []
            for x in stra:
                if (x['line']['project'] or {}).get('code') == p['code']:
                    rows += strategic_rows(x, mode)
            sch.append(dict(key=f'C.{i}', title=f"C.{i} {p['code']} {p['name']}", rows=rows))
        out.append(dict(key='C', title=f"C. Cheltuieli strategice ({dims['STRATEGIC'].get('fm', 'FM-STR')}) – {prog}", children=sch))
        return out

    # fund contribution plan (targetPlan) per month of the fiscal year
    def plan_months(f):
        plan = f.get('targetPlan') or {}
        per, cnt = plan.get('perPeriodAmount'), plan.get('periodCount')
        if not per or not cnt or not f.get('startPeriodCode'):
            return None
        sy, sm = map(int, f['startPeriodCode'].split('-'))
        s = sy * 12 + sm - 1
        return [per if s <= year * 12 + m < s + cnt else 0 for m in range(12)], plan, f['startPeriodCode']

    wb = Workbook()
    wb.remove(wb.active)
    sheet_rows = {}

    def style(c, bold=False, fill=None, fmt=None, wrap=False, align=None, size=10, color=None, italic=False):
        c.font = Font(name=FONT, size=size, bold=bold, color=color, italic=italic)
        if fill:
            c.fill = fill
        if fmt:
            c.number_format = fmt
        c.alignment = Alignment(wrap_text=wrap, horizontal=align, vertical='center' if not wrap else 'top')
        c.border = BORDER

    def build(mode):
        title = {'buget': f'{year}-Buget', 'exec': f'{year}-Exec', 'actual': str(year)}[mode]
        ws = wb.create_sheet(title)
        refs = {}
        ws['A2'] = f"Asociația de proprietari {comm['name']} (Palatul Kralik)"
        adm = (info.get('administrator') or {}).get('company')
        ws['A3'] = f'Administrator: {adm}' if adm else ''
        ws['A4'] = (f"Versiune buget: {ver['code']} – {ver['name']} ({ver['status']})" if mode != 'actual'
                    else 'Sursa: cheltuieli repartizate în aplicație (perioade închise) + registrul de plăți al programului de reabilitare')
        for a in ('A2', 'A3', 'A4'):
            ws[a].font = Font(name=FONT, size=11, bold=a == 'A2')
        ws['A5'] = {'buget': f'PROPUNERE BUGET DE VENITURI ȘI CHELTUIELI AN {year} – OPERAȚIONAL, TACTIC, STRATEGIC',
                    'exec': f'EXECUȚIE BUGET AN {year} – BUGET vs FORECAST vs ACTUAL (ultima lună închisă: {ver.get("latestClosedPeriod")})',
                    'actual': f'EXECUȚIE AN {year} – VENITURI ȘI CHELTUIELI REALIZATE – OPERAȚIONAL, TACTIC, STRATEGIC'}[mode]
        ws['A5'].font = Font(name=FONT, size=16, bold=True)
        ws['A5'].alignment = Alignment(horizontal='center')
        ws.merge_cells(start_row=5, start_column=1, end_row=5, end_column=C_DPCT)

        heads = {C_NR: 'Nr Crt', C_CAP: 'Capitol', C_NAME: 'Denumire venit / cheltuială', C_STATUS: 'Status',
                 C_VENDOR: 'Furnizor', C_FUND: 'Fond (sursa de finanțare)', C_SIM: 'SIM',
                 C_TOT: f'Total {year}', C_PRE: f'Plătit înainte de {year} / fără dată',
                 C_REST: 'Nefazat (rest de plătit)' if mode == 'exec' else 'Buget proiect (nefazat pe luni)',
                 C_ALL: 'Total linie' if mode == 'buget' else 'Forecast total linie',
                 C_CMP: f'Real {year - 1}' if mode == 'buget' else f'Buget {year}',
                 C_DELTA: 'Delta\n[RON]' if mode == 'buget' else 'Abatere\n(Forecast − Buget)',
                 C_DPCT: 'Delta\n[%]' if mode == 'buget' else 'Abatere\n[%]', C_NOTE: 'Comentarii / modul de calcul'}
        for i, mname in enumerate(MONTHS_RO):
            heads[C_M0 + i] = mname
        for i in range(4):
            heads[C_Q0 + i] = f'T{i + 1}'
        for col, h in heads.items():
            c = ws.cell(HEAD_ROW, col, h)
            style(c, bold=True, fill=HEAD_FILL, wrap=True, align='center', size=10)
        if mode == 'actual':
            heads.update({C_PRE: f'Plătit înainte de {year}', C_REST: '—', C_ALL: f'Cumulat la 31.12.{year}',
                          C_CMP: f'Real {year - 1}', C_DELTA: 'Delta\n[RON]', C_DPCT: 'Delta\n[%]'})
            for col, h in heads.items():
                ws.cell(HEAD_ROW, col, h)
        if mode in ('exec', 'actual'):
            lab = {'ACTUAL': 'Actual', 'DRAFT': 'Ciornă', 'ESTIMATE': 'Forecast'}
            for i, mc in enumerate(month_codes):
                k = kinds.get(mc, 'ESTIMATE')
                c = ws.cell(HEAD_ROW - 1, C_M0 + i, lab.get(k, k))
                style(c, bold=True, align='center', fill=ACT_FILL if k == 'ACTUAL' else (DRAFT_FILL if k == 'DRAFT' else None), size=9)
                if k == 'ACTUAL':
                    ws.cell(HEAD_ROW, C_M0 + i).fill = ACT_FILL
            ws.cell(HEAD_ROW - 1, C_M0 - 1, 'Tip lună →').font = Font(name=FONT, size=9, italic=True)
        if mode == 'exec':
            ws.cell(HEAD_ROW, C_M0).comment = Comment(
                'Operațional/Tactic: lunile marcate Actual = cost repartizat în luni închise; Ciornă = luna în pregătire; '
                'Forecast = estimare. Strategic: lunile conțin plățile efective datate din registrul de plăți.', 'buget')
        ws.cell(HEAD_ROW, C_SIM).comment = Comment('Multiplicator: 1 = inclus, 0 = exclus din total (ca în bugetul de referință).', 'buget')
        if mode != 'actual': ws.cell(HEAD_ROW, C_REST).comment = Comment(
            'Strategic: proiectele sunt multianuale. În foaia Buget = bugetul de bază al liniei (nefazat). '
            'În foaia Exec = Forecast − total plătit (rămâne de plătit, fără lună stabilită).', 'buget')
        ws.row_dimensions[HEAD_ROW].height = 42
        r = HEAD_ROW + 1
        line_rows = []      # all leaf rows (for SUMPRODUCT ranges)
        main_of = {}        # sub row -> main row (strategic multi-fund)

        def put_section(text):
            nonlocal r
            for col in range(1, LAST + 1):
                style(ws.cell(r, col), bold=True, fill=SECT_FILL)
            ws.cell(r, C_NR, text.split(' ', 1)[0])
            ws.cell(r, C_NAME, text.split(' ', 1)[1])
            r += 1

        def write_values(row, rd):
            for i, v in enumerate(rd['months']):
                c = ws.cell(row, C_M0 + i, v if v not in (None,) else None)
                style(c, fmt=NUM)
                if mode in ('exec', 'actual') and kinds.get(month_codes[i]) == 'ACTUAL':
                    c.fill = PatternFill('solid', fgColor='F2F2F2')
            style(ws.cell(row, C_SIM, 1), align='center')
            mr = f'{L(C_M0)}{row}:{L(C_M0 + 11)}{row}'
            style(ws.cell(row, C_TOT, f'=SUM({mr})*{L(C_SIM)}{row}'), bold=True, fmt=RON)
            for q in range(4):
                a, z = L(C_M0 + q * 3), L(C_M0 + q * 3 + 2)
                style(ws.cell(row, C_Q0 + q, f'=SUM({a}{row}:{z}{row})*{L(C_SIM)}{row}'), fmt=NUM)
            style(ws.cell(row, C_PRE, rd.get('pre')), fmt=NUM)
            style(ws.cell(row, C_REST, rd.get('rest')), fmt=NUM)
            style(ws.cell(row, C_ALL, f'=({L(C_PRE)}{row}+{L(C_REST)}{row})*{L(C_SIM)}{row}+{L(C_TOT)}{row}'), bold=True, fmt=RON)

        def put_line(rd, n, cap):
            nonlocal r
            row = r
            for col in range(1, LAST + 1):
                style(ws.cell(row, col))
            ws.cell(row, C_NR, n if rd['kind'] == 'line' else None).alignment = Alignment(horizontal='center')
            ws.cell(row, C_CAP, cap)
            ws.cell(row, C_NAME, (f"({rd['code']}) " if rd['code'] else '') + rd['name'])
            ws.cell(row, C_STATUS, rd['status'])
            ws.cell(row, C_VENDOR, rd['vendor'])
            ws.cell(row, C_FUND, rd['fund'])
            if rd['kind'] == 'sub':
                for col in (C_NAME, C_FUND):
                    ws.cell(row, col).font = Font(name=FONT, size=10, italic=True, color='595959')
            write_values(row, rd)
            if rd.get('cmp') is not None:
                style(ws.cell(row, C_CMP, rd['cmp']), fmt=NUM)
            # delta: main strategic row absorbs its sub rows
            subs = rd.get('subs') or 0
            if rd['kind'] == 'line' and (rd.get('cmp') is not None or mode == 'exec') and not (mode == 'buget' and rd['line']['dimension'] == 'STRATEGIC'):
                tot = f'{L(C_ALL)}{row}' + ''.join(f'+{L(C_ALL)}{row + k}' for k in range(1, subs + 1))
                style(ws.cell(row, C_DELTA, f'={tot}-{L(C_CMP)}{row}'), fmt=NUM, bold=True)
                style(ws.cell(row, C_DPCT, f'=IF({L(C_CMP)}{row}=0,"",{L(C_DELTA)}{row}/{L(C_CMP)}{row})'), fmt=PCT)
            ws.cell(row, C_NOTE, rd.get('note'))
            ws.cell(row, C_NOTE).alignment = Alignment(wrap_text=False, vertical='center')
            ws.cell(row, C_NOTE).font = Font(name=FONT, size=9)
            line_rows.append(row)
            r += 1
            return row

        def put_subtotal(text, children_rows=None, leaf_range=None, fill=HEAD_FILL, cap='Subtotal', bold=True):
            """children_rows: list of subtotal rows to add; leaf_range: (a, z) of line rows."""
            nonlocal r
            row = r
            for col in range(1, LAST + 1):
                style(ws.cell(row, col), bold=bold, fill=fill)
            ws.cell(row, C_CAP, cap)
            ws.cell(row, C_NAME, text)
            sumcols = list(range(C_M0, C_M0 + 12)) + [C_TOT] + list(range(C_Q0, C_Q0 + 4)) + [C_PRE, C_REST, C_ALL, C_CMP, C_DELTA]
            for col in sumcols:
                cl = L(col)
                if children_rows is not None:
                    f = '=' + ('+'.join(f'{cl}{x}' for x in children_rows) if children_rows else '0')
                elif leaf_range and leaf_range[1] >= leaf_range[0]:
                    a, z = leaf_range
                    if C_M0 <= col < C_M0 + 12 or col in (C_PRE, C_REST):
                        f = f'=SUMPRODUCT({cl}{a}:{cl}{z},{L(C_SIM)}{a}:{L(C_SIM)}{z})'
                    else:
                        f = f'=SUM({cl}{a}:{cl}{z})'
                else:
                    f = 0
                ws.cell(row, col, f).number_format = RON if col in (C_TOT, C_ALL) else NUM
            ws.cell(row, C_DPCT, f'=IF({L(C_CMP)}{row}=0,"",{L(C_DELTA)}{row}/{L(C_CMP)}{row})').number_format = PCT
            r += 1
            return row

        # ---- I. VENITURI ----
        put_section('I. VENITURI (contribuții repartizate la fonduri)' if mode == 'actual' else 'I. VENITURI (contribuții planificate la fonduri)')
        ven_rows = {}
        n = 0
        ven_start = r
        exp_row_placeholder = None
        for code in order:
            f = funds.get(code)
            if not f or code == 'PENALIZARI':
                continue
            n += 1
            row = r
            for col in range(1, LAST + 1):
                style(ws.cell(row, col))
            ws.cell(row, C_NR, n)
            ws.cell(row, C_CAP, 'Venituri')
            ws.cell(row, C_STATUS, (f.get('allocation') or {}).get('type') or '')
            ws.cell(row, C_VENDOR, 'NA')
            ws.cell(row, C_FUND, f['name'])
            if code == 'EXPENSES':
                ws.cell(row, C_NAME, f"{f['name']} – recuperarea cheltuielilor repartizate (= cheltuielile plătite din acest fond)")
                exp_row_placeholder = row
                ws.cell(row, C_NOTE, 'Formula: suma cheltuielilor din secțiunea II cu Fond = ' + f['name'] + '.').font = Font(name=FONT, size=9)
                style(ws.cell(row, C_SIM, 1), align='center')
            else:
                pm = plan_months(f) if mode != 'actual' else None
                ws.cell(row, C_NAME, f"Contribuție {f['name']}" + (f" ({(f.get('allocation') or {}).get('altName')})" if (f.get('allocation') or {}).get('altName') else ''))
                if mode == 'actual':
                    write_values(row, dict(months=[r2(fch.get((code, mc), 0)) for mc in month_codes]))
                    ws.cell(row, C_NOTE, 'Real: contribuții repartizate (facturate) pe fond în lunile închise.').font = Font(name=FONT, size=9)
                elif pm:
                    vals, plan, start = pm
                    write_values(row, dict(months=[v or 0 for v in vals]))
                    ws.cell(row, C_NOTE, f"Plan fond: {plan['perPeriodAmount']:,} lei/lună × {plan['periodCount']} luni de la {start}"
                            ).font = Font(name=FONT, size=9)
                else:
                    write_values(row, dict(months=[0] * 12))
                    ws.cell(row, C_NOTE, 'Fondul nu are grafic lunar de contribuții în aplicație – de completat.').font = Font(name=FONT, size=9)
            ven_rows[code] = row
            r += 1
        ven_end = r - 1
        ven_tot = put_subtotal('Total venituri', leaf_range=(ven_start, ven_end), cap='Subtotal')

        # ---- II. CHELTUIELI ----
        put_section('II. CHELTUIELI')
        top_rows = {}
        for g in groups(mode):
            child_tot = []
            dim_hdr = r
            for col in range(1, LAST + 1):
                style(ws.cell(r, col), bold=True, fill=HEAD_FILL)
            ws.cell(r, C_CAP, 'Subtotal')
            ws.cell(r, C_NAME, g['title'])
            r += 1
            for ch in g['children']:
                if ch['title']:
                    sub_hdr = r
                    for col in range(1, LAST + 1):
                        style(ws.cell(r, col), bold=True, fill=GRP_FILL)
                    ws.cell(r, C_CAP, 'Subtotal')
                    ws.cell(r, C_NAME, ch['title'])
                    r += 1
                a = r
                n = 0
                for rd in ch['rows']:
                    if rd['kind'] == 'line':
                        n += 1
                    put_line(rd, n, ch['title'] or g['title'].split(' – ')[0])
                z = r - 1
                if ch['title']:
                    # write formulas into the header row of the sub-group (subtotal above its lines, like the reference)
                    save = r
                    r = sub_hdr
                    put_subtotal(ch['title'], leaf_range=(a, z), fill=GRP_FILL)
                    r = save
                    child_tot.append(sub_hdr)
                    refs[ch['key']] = sub_hdr
                else:
                    child_leaf = (a, z)
            save = r
            r = dim_hdr
            if len(g['children']) == 1 and not g['children'][0]['title']:
                put_subtotal(g['title'], leaf_range=child_leaf)
            else:
                put_subtotal(g['title'], children_rows=child_tot)
            r = save
            top_rows[g['key']] = dim_hdr
            refs[g['key']] = dim_hdr
        tot_ch = put_subtotal('Total cheltuieli (A + B + C)', children_rows=list(top_rows.values()), fill=TOTAL_FILL, cap='Total')
        refs['TOTAL'] = tot_ch
        first_line, last_line = min(line_rows), max(line_rows)

        # venituri: EXPENSES row = cheltuieli din fond (formula)
        if exp_row_placeholder:
            row = exp_row_placeholder
            nm = fname['EXPENSES']
            for i in range(12):
                cl = L(C_M0 + i)
                style(ws.cell(row, C_M0 + i, f'=SUMPRODUCT(({L(C_FUND)}${first_line}:{L(C_FUND)}${last_line}="{nm}")*{cl}${first_line}:{cl}${last_line}*{L(C_SIM)}${first_line}:{L(C_SIM)}${last_line})'), fmt=NUM)
            mr = f'{L(C_M0)}{row}:{L(C_M0 + 11)}{row}'
            style(ws.cell(row, C_TOT, f'=SUM({mr})*{L(C_SIM)}{row}'), bold=True, fmt=RON)
            for q in range(4):
                a, z = L(C_M0 + q * 3), L(C_M0 + q * 3 + 2)
                style(ws.cell(row, C_Q0 + q, f'=SUM({a}{row}:{z}{row})*{L(C_SIM)}{row}'), fmt=NUM)
            style(ws.cell(row, C_ALL, f'={L(C_TOT)}{row}'), bold=True, fmt=RON)

        # ---- III. FONDURI ----
        r += 1
        put_section('III. FONDURI – contribuții vs cheltuieli ' + ('realizate' if mode == 'actual' else 'planificate') + ' pe fiecare fond')
        fund_list = [c for c in order if c in funds and c != 'PENALIZARI'] + ['_']
        fund_rows = {}
        for code in fund_list:
            nm = fname.get(code, UNSPEC) if code != '_' else UNSPEC
            for col in range(1, LAST + 1):
                style(ws.cell(r, col), bold=True, fill=GRP_FILL)
            ws.cell(r, C_NAME, nm)
            r += 1
            rr = {}
            for kind, label in (('in', 'Contribuții (venituri)'), ('out', 'Cheltuieli din fond'), ('net', 'Net (contribuții − cheltuieli)')):
                row = r
                for col in range(1, LAST + 1):
                    style(ws.cell(row, col), bold=(kind == 'net'))
                ws.cell(row, C_CAP, 'Fonduri')
                ws.cell(row, C_NAME, '   ' + label)
                ws.cell(row, C_FUND, nm)
                for col in list(range(C_M0, C_M0 + 12)) + [C_TOT] + list(range(C_Q0, C_Q0 + 4)) + [C_PRE, C_REST, C_ALL]:
                    cl = L(col)
                    if kind == 'in':
                        f = f'={cl}{ven_rows[code]}' if code in ven_rows and col not in (C_PRE, C_REST) else 0
                    elif kind == 'out':
                        if col in (C_TOT, C_ALL) or C_Q0 <= col < C_Q0 + 4:
                            f = f'=SUMPRODUCT(({L(C_FUND)}${first_line}:{L(C_FUND)}${last_line}="{nm}")*{cl}${first_line}:{cl}${last_line})'
                        else:
                            f = f'=SUMPRODUCT(({L(C_FUND)}${first_line}:{L(C_FUND)}${last_line}="{nm}")*{cl}${first_line}:{cl}${last_line}*{L(C_SIM)}${first_line}:{L(C_SIM)}${last_line})'
                    else:
                        f = f'={cl}{rr["in"]}-{cl}{rr["out"]}'
                    ws.cell(row, col, f).number_format = RON if col in (C_TOT, C_ALL) else NUM
                rr[kind] = row
                r += 1
            fund_rows[code] = rr
            if code == '_':
                ws.cell(rr['out'], C_NOTE, 'Linii strategice pentru care registrul nu precizează fondul sursă – de confirmat.').font = Font(name=FONT, size=9)
            elif (funds.get(code, {}).get('allocation') or {}).get('type') == 'Strategic':
                ws.cell(rr['out'], C_NOTE, 'Coloanele „înainte de an”, „nefazat” și „total linie” sunt cumulate pe durata proiectului.').font = Font(name=FONT, size=9)
        refs['funds'] = fund_rows
        refs['ven'] = ven_rows
        refs['ven_tot'] = ven_tot

        # ---- semnături (ca în modelul de referință) ----
        r += 2
        ws.cell(r, C_NAME, 'Întocmit').font = Font(name=FONT, size=10, bold=True)
        r += 1
        if adm:
            ws.cell(r, C_NAME, adm).font = Font(name=FONT, size=10)
            r += 1
        for m in info.get('boardMembers') or []:
            ws.cell(r, C_NAME, f"{m.get('role')}: {m.get('name')}").font = Font(name=FONT, size=10)
            r += 1

        # layout
        widths = {C_NR: 7, C_CAP: 26, C_NAME: 58, C_STATUS: 13, C_VENDOR: 24, C_FUND: 22, C_SIM: 5, C_TOT: 15,
                  C_PRE: 15, C_REST: 15, C_ALL: 16, C_CMP: 14, C_DELTA: 14, C_DPCT: 9, C_NOTE: 90}
        for i in range(12):
            widths[C_M0 + i] = 11.5
        for q in range(4):
            widths[C_Q0 + q] = 12
        for col, w in widths.items():
            ws.column_dimensions[L(col)].width = w
        ws.freeze_panes = ws.cell(HEAD_ROW + 1, C_M0)
        ws.auto_filter.ref = f'A{HEAD_ROW}:{L(LAST)}{tot_ch}'
        ws.sheet_view.zoomScale = 85
        ws.page_setup.orientation = 'landscape'
        ws.page_setup.fitToWidth = 1
        ws.sheet_properties.pageSetUpPr.fitToPage = True
        ws.page_setup.fitToHeight = 0
        sheet_rows[title] = (title, refs)
        sheet_rows[mode] = (title, refs)

    build('buget')
    build('exec')

    # ---- Sumar ----
    ws = wb.create_sheet(f'{year}-Sumar', 0)
    tb, rb = sheet_rows['buget']
    te, re_ = sheet_rows['exec']
    ws['A1'] = f"{comm['name']} (Palatul Kralik) – Buget {year}: Buget vs Actual vs Forecast"
    ws['A1'].font = Font(name=FONT, size=14, bold=True)
    ws['A2'] = (f"Versiune {ver['code']} ({ver['status']}). Ultima lună închisă: {ver.get('latestClosedPeriod')}. "
                'Operațional și Tactic = anul fiscal; Strategic = cumulat pe durata programului (bugetul de bază, plătit, forecast).')
    ws['A2'].font = Font(name=FONT, size=9, italic=True)
    hdr = ['Capitol', 'Buget', 'Actual', 'Forecast', 'Abatere (Forecast − Buget)', 'Abatere %', 'Rest de cheltuit (Forecast − Actual)']
    for i, h in enumerate(hdr, 1):
        style(ws.cell(4, i, h), bold=True, fill=HEAD_FILL, wrap=True, align='center')
    actual_cols = [C_M0 + i for i, mc in enumerate(month_codes) if kinds.get(mc) == 'ACTUAL']
    act_rng = f'{L(actual_cols[0])}{{r}}:{L(actual_cols[-1])}{{r}}' if actual_cols else None
    rows = [('A', 'A. Operațional (FM-OPE)', True), ('B', 'B. Tactic (FM-TAC)', True), ('B.1', '   B.1 Mentenanță preventivă', False),
            ('B.2', '   B.2 Mentenanță reactivă', False), ('C', 'C. Strategic (FM-STR) – Program de reabilitare', True)]
    k = 1
    while f'C.{k}' in re_:
        rows.append((f'C.{k}', '   ' + (te and f'C.{k}'), False))
        k += 1
    r = 5
    sum_rows = {}
    for key, label, bold in rows:
        er = re_[key]
        if key.startswith('C.'):
            label = "='" + te + "'!C" + str(er)
        ws.cell(r, 1, label)
        ws.cell(r, 2, f"='{te}'!{L(C_CMP)}{er}")
        if key.startswith('C'):
            ws.cell(r, 3, f"='{te}'!{L(C_PRE)}{er}+'{te}'!{L(C_TOT)}{er}")
            ws.cell(r, 4, f"='{te}'!{L(C_ALL)}{er}")
        else:
            ws.cell(r, 3, f"=SUM('{te}'!{act_rng.format(r=er)})" if act_rng else 0)
            ws.cell(r, 4, f"='{te}'!{L(C_ALL)}{er}")
        ws.cell(r, 5, f'=D{r}-B{r}')
        ws.cell(r, 6, f'=IF(B{r}=0,"",E{r}/B{r})')
        ws.cell(r, 7, f'=D{r}-C{r}')
        for col in range(1, 8):
            style(ws.cell(r, col), bold=bold, fmt=(PCT if col == 6 else (RON if col > 1 else None)), fill=HEAD_FILL if bold else None)
        sum_rows[key] = r
        r += 1
    for col, f in ((1, 'TOTAL (A + B + C)'),):
        ws.cell(r, 1, f)
    for col in range(2, 8):
        cl = L(col)
        ws.cell(r, col, '=' + '+'.join(f'{cl}{sum_rows[x]}' for x in ('A', 'B', 'C')) if col != 6 else f'=IF(B{r}=0,"",E{r}/B{r})')
    for col in range(1, 8):
        style(ws.cell(r, col), bold=True, fill=TOTAL_FILL, fmt=(PCT if col == 6 else (RON if col > 1 else None)))
    r += 1
    ws.cell(r, 1, f"Actual Operațional/Tactic = lunile închise ({', '.join(MONTHS_RO[c - C_M0] for c in actual_cols[:1])}–{MONTHS_RO[actual_cols[-1] - C_M0] if actual_cols else ''}); "
                  'Actual Strategic = toate plățile din registru (inclusiv anii anteriori).').font = Font(name=FONT, size=9, italic=True)

    # funds table
    r += 2
    hdr = ['Fond', 'Tip', 'Țintă fond', f'Contribuții plan {year}', 'Încasat în aplicație (cumulat)',
           f'Cheltuieli buget {year} / proiect', 'Cheltuieli forecast', 'Țintă − Forecast cheltuieli']
    for i, h in enumerate(hdr, 1):
        style(ws.cell(r, i, h), bold=True, fill=HEAD_FILL, wrap=True, align='center')
    r += 1
    target = {f['code']: f.get('target') for f in b['funds'] if f.get('code')}
    coll = defaultdict(float)
    for x in d['collections']:
        coll[x['fundCode']] += x['amount']
    fr0 = r
    for code in [c for c in order if c in funds and c != 'PENALIZARI'] + ['_']:
        f = funds.get(code) or {}
        fb, fe = rb['funds'][code], re_['funds'][code]
        ws.cell(r, 1, f.get('name', UNSPEC))
        ws.cell(r, 2, (f.get('allocation') or {}).get('type') or '')
        ws.cell(r, 3, target.get(code) or f.get('targetAmount'))
        ws.cell(r, 4, f"='{tb}'!{L(C_TOT)}{fb['in']}")
        ws.cell(r, 5, r2(coll.get(code, 0)) if code != '_' else None)
        ws.cell(r, 6, f"='{tb}'!{L(C_ALL)}{fb['out']}")
        ws.cell(r, 7, f"='{te}'!{L(C_ALL)}{fe['out']}")
        ws.cell(r, 8, f'=IF(C{r}="","",C{r}-G{r})')
        for col in range(1, 9):
            style(ws.cell(r, col), fmt=RON if col > 2 else None)
        r += 1
    ws.cell(r, 1, 'Total')
    for col in (3, 4, 5, 6, 7):
        ws.cell(r, col, f'=SUM({L(col)}{fr0}:{L(col)}{r - 1})')
    for col in range(1, 9):
        style(ws.cell(r, col), bold=True, fill=TOTAL_FILL, fmt=RON if col > 2 else None)
    r += 1
    first_coll = min((x['periodCode'] for x in d['collections']), default='—')
    ws.cell(r, 1, f'„Încasat în aplicație” include doar încasările înregistrate în aplicație (de la {first_coll}); '
                  'pentru fondurile mai vechi (ex. Reabilitare 1) încasările anterioare nu apar aici.').font = Font(name=FONT, size=9, italic=True)
    r += 1
    ws.cell(r, 1, 'Strategic: cheltuielile pe fond folosesc fondul liniei; plățile unei linii făcute din alt fond apar pe rânduri separate „↳ plăți din …”.').font = Font(name=FONT, size=9, italic=True)
    for col, w in zip('ABCDEFGH', (58, 13, 16, 18, 20, 20, 18, 20)):
        ws.column_dimensions[col].width = w

    # ---- past years: same layout, realised figures ----
    fy = ver['fiscalYear']
    past = [y for y in range(first_year, fy)]
    for y in past:
        year = y
        month_codes = [f'{y}-{m:02d}' for m in range(1, 13)]
        kinds = {mc: 'ACTUAL' for mc in month_codes}
        build('actual')
    year = fy

    # ---- Sumar pe ani ----
    ws = wb.create_sheet('Sumar pe ani')
    ws['A1'] = f"{comm['name']} (Palatul Kralik) – Venituri și cheltuieli pe ani ({first_year}–{fy})"
    ws['A1'].font = Font(name=FONT, size=14, bold=True)
    ws['A2'] = (f'{first_year}–{fy - 1}: realizat (perioade închise + plăți efectuate). {fy}: buget, actual (luni închise / plăți) '
                f'și forecast. Strategic nu are buget anual (proiect multianual) – vezi foaia Portofoliu.')
    ws['A2'].font = Font(name=FONT, size=9, italic=True)
    tb, rb = sheet_rows['buget']
    te, re_ = sheet_rows['exec']
    cols = [(str(y), f'Real {y}', 'T') for y in past] + [(tb, f'Buget {fy}', 'B'), (te, f'Actual {fy} (YTD)', 'A'), (te, f'Forecast {fy}', 'F')]
    hdr = ['Capitol'] + [c[1] for c in cols] + [f'Forecast {fy} − Buget', f'Forecast {fy} vs Real {fy - 1} [%]', 'Strategic: rest de plătit (nefazat)']
    for i, h in enumerate(hdr, 1):
        style(ws.cell(4, i, h), bold=True, fill=HEAD_FILL, wrap=True, align='center')
    ws.row_dimensions[4].height = 45
    actual_cols26 = [C_M0 + i for i in range(12) if kinds26.get(f'{fy}-{i + 1:02d}') == 'ACTUAL']
    spec = [('sect', 'I. VENITURI (contribuții la fonduri)')]
    for code in order:
        if code in rb['ven']:
            spec.append(('ven', code))
    spec += [('ven_tot', 'Total venituri'), ('sect', 'II. CHELTUIELI'),
             ('g', 'A', 'A. Operațional (FM-OPE)'), ('g', 'B', 'B. Tactic (FM-TAC)'), ('g', 'B.1', '   B.1 Mentenanță preventivă'),
             ('g', 'B.2', '   B.2 Mentenanță reactivă'), ('g', 'C', 'C. Strategic (FM-STR) – plăți în an')]
    k = 1
    while f'C.{k}' in re_:
        spec.append(('g', f'C.{k}', None))
        k += 1
    spec.append(('g', 'TOTAL', 'Total cheltuieli'))
    r = 5
    ncol = len(hdr)
    sum_at = {}
    for it in spec:
        if it[0] == 'sect':
            ws.cell(r, 1, it[1])
            for col in range(1, ncol + 1):
                style(ws.cell(r, col), bold=True, fill=SECT_FILL)
            r += 1
            continue
        if it[0] == 'ven':
            key, label, strategic = it[1], fname.get(it[1], it[1]), False
            rowof = lambda refs: refs['ven'].get(key)
        elif it[0] == 'ven_tot':
            key, label, strategic = 'ven_tot', it[1], False
            rowof = lambda refs: refs['ven_tot']
        else:
            key, label = it[1], it[2]
            strategic = key.startswith('C')
            rowof = (lambda key: (lambda refs: refs.get(key)))(key)
        if key == 'TOTAL':  # sum of the A/B/C rows of this sheet (annual figures only)
            ws.cell(r, 1, label)
            for col in list(range(2, 2 + len(cols))) + [ncol - 2, ncol]:
                ws.cell(r, col, '=' + '+'.join(f'N({L(col)}{sum_at[x]})' for x in ('A', 'B', 'C')))
            cF, cPrev = L(1 + len(past) + 3), L(1 + len(past))
            ws.cell(r, ncol - 1, f'=IF(N({cPrev}{r})=0,"",{cF}{r}/{cPrev}{r}-1)' if past else None)
            for col in range(1, ncol + 1):
                style(ws.cell(r, col), bold=True, fill=TOTAL_FILL, fmt=(PCT if col == ncol - 1 else (RON if col > 1 else None)))
            r += 1
            continue
        sum_at[key] = r
        if label is None:
            label = f"='{te}'!C{re_[key]}"
        ws.cell(r, 1, label)
        bold = it[0] == 'ven_tot' or (it[0] == 'g' and '.' not in key)
        for i, (sh, _, kind) in enumerate(cols, 2):
            refs = sheet_rows[sh][1]
            rr = rowof(refs)
            if rr is None:
                v = None
            elif kind == 'T':
                v = f"='{sh}'!{L(C_TOT)}{rr}"
            elif kind == 'B':
                v = None if strategic else f"='{sh}'!{L(C_ALL)}{rr}"
            elif kind == 'A':
                if strategic or it[0].startswith('ven'):
                    v = f"='{sh}'!{L(C_TOT)}{rr}" if strategic else None
                else:
                    v = f"=SUM('{sh}'!{L(actual_cols26[0])}{rr}:{L(actual_cols26[-1])}{rr})" if actual_cols26 else 0
            else:  # forecast of the year: monthly total (+ unspent provision for tactic)
                v = f"='{sh}'!{L(C_TOT)}{rr}" if (strategic or it[0].startswith('ven')) else f"='{sh}'!{L(C_TOT)}{rr}+'{sh}'!{L(C_REST)}{rr}"
            ws.cell(r, i, v)
        cB, cF, cPrev = L(1 + len(past) + 1), L(1 + len(past) + 3), L(1 + len(past))
        ws.cell(r, ncol - 2, None if strategic else f'=IF({cB}{r}="","",{cF}{r}-{cB}{r})')
        ws.cell(r, ncol - 1, f'=IF(N({cPrev}{r})=0,"",{cF}{r}/{cPrev}{r}-1)' if past else None)
        rr = rowof(re_)
        ws.cell(r, ncol, f"='{te}'!{L(C_REST)}{rr}" if strategic and rr else None)
        for col in range(1, ncol + 1):
            style(ws.cell(r, col), bold=bold, fill=(TOTAL_FILL if key in ('TOTAL', 'ven_tot') else (HEAD_FILL if bold else None)),
                  fmt=(PCT if col == ncol - 1 else (RON if col > 1 else None)))
        r += 1
    r += 1
    for t in ('„Real” = cheltuieli repartizate în perioadele închise și contribuțiile repartizate pe fonduri; Strategic = plățile datate din registrul de plăți (plățile fără dată apar doar în Portofoliu și în 2026-Exec).',
              f'Forecast {fy} Tactic include provizionul de reparații necheltuit în lunile închise (presupus consumat).'):
        ws.cell(r, 1, t).font = Font(name=FONT, size=9, italic=True)
        r += 1
    ws.column_dimensions['A'].width = 52
    for i in range(2, ncol + 1):
        ws.column_dimensions[L(i)].width = 16
    ws.freeze_panes = 'B5'

    # ---- Portofoliu (program → proiecte → linii, plăți pe ani) ----
    ws = wb.create_sheet('Portofoliu')
    ws['A1'] = 'Portofoliu – Program de reabilitare Palatul Kralik: buget, angajat, forecast și plăți pe ani'
    ws['A1'].font = Font(name=FONT, size=14, bold=True)
    stra = [x for x in lines if x['line']['dimension'] == 'STRATEGIC']
    pay_years = sorted({e['date'][:4] for x in stra for e in x['entries'] if e['kind'] == 'PAYMENT' and e.get('date')})
    ycols = [f'≤{first_year - 1}'] + [str(y) for y in range(first_year, fy + 1)]
    hdr = ['ID', 'Program', 'Proiect', 'Arie', 'Linie (furnizor – document)', 'Fond', 'Status', 'Buget [RON]', 'Angajat', 'Estimare',
           'Forecast'] + [f'Plătit {c}' for c in ycols] + ['Plătit fără dată', 'Total plătit', 'Rest de plătit', 'Abatere (Forecast − Buget)']
    for i, h in enumerate(hdr, 1):
        style(ws.cell(3, i, h), bold=True, fill=HEAD_FILL, wrap=True, align='center')
    ws.row_dimensions[3].height = 45
    c_bud, c_com, c_est, c_fc = 8, 9, 10, 11
    c_y0 = 12
    c_nd = c_y0 + len(ycols)
    c_tp, c_rest, c_var = c_nd + 1, c_nd + 2, c_nd + 3
    r = 4
    proj_rows = []
    projs = []
    for x in stra:
        p = x['line']['project']
        if p and p['code'] not in [q['code'] for q in projs]:
            projs.append(p)
    projs.sort(key=lambda p: p['code'])
    for p in projs:
        hr = r
        ws.cell(r, 2, p['program']['name'])
        ws.cell(r, 3, f"{p['code']} {p['name']}")
        r += 1
        a = r
        for x in stra:
            line, met = x['line'], x['metrics']
            if (line['project'] or {}).get('code') != p['code']:
                continue
            ws.cell(r, 1, line['code'])
            ws.cell(r, 2, p['program']['code'])
            ws.cell(r, 3, p['code'])
            ws.cell(r, 4, line.get('area'))
            ws.cell(r, 5, line['name'])
            ws.cell(r, 6, fund_label(line.get('fundCode')))
            ws.cell(r, 7, line['statusLabel'])
            ws.cell(r, c_bud, r2(met['budget']))
            ws.cell(r, c_com, r2(met.get('committed') or 0))
            ws.cell(r, c_est, r2(met.get('estimate') or 0))
            ws.cell(r, c_fc, r2(met['forecast']))
            byy = defaultdict(float)
            for e in x['entries']:
                if e['kind'] != 'PAYMENT':
                    continue
                yv = (e.get('date') or '')[:4]
                key = 'nd' if not yv else (ycols[0] if int(yv) < first_year else yv)
                byy[key] += e['amount']
            for i, ccode in enumerate(ycols):
                ws.cell(r, c_y0 + i, r2(byy.get(ccode, 0)) or None)
            ws.cell(r, c_nd, r2(byy.get('nd', 0)) or None)
            ws.cell(r, c_tp, f'=SUM({L(c_y0)}{r}:{L(c_nd)}{r})')
            ws.cell(r, c_rest, f'=MAX({L(c_fc)}{r}-{L(c_tp)}{r},0)')
            ws.cell(r, c_var, f'={L(c_fc)}{r}-{L(c_bud)}{r}')
            for col in range(1, len(hdr) + 1):
                style(ws.cell(r, col), fmt=NUM if col >= c_bud else None)
            r += 1
        z = r - 1
        for col in range(c_bud, len(hdr) + 1):
            ws.cell(hr, col, f'=SUM({L(col)}{a}:{L(col)}{z})')
        for col in range(1, len(hdr) + 1):
            style(ws.cell(hr, col), bold=True, fill=GRP_FILL, fmt=RON if col >= c_bud else None)
        proj_rows.append(hr)
    ws.cell(r, 2, 'Total program')
    for col in range(c_bud, len(hdr) + 1):
        ws.cell(r, col, '=' + '+'.join(f'{L(col)}{x}' for x in proj_rows))
    for col in range(1, len(hdr) + 1):
        style(ws.cell(r, col), bold=True, fill=TOTAL_FILL, fmt=RON if col >= c_bud else None)
    r += 2
    ws.cell(r, 1, 'Buget = „Bugetat” cu „Bugetat – inclus” = da/NA/personal; Angajat = „Datorat”; Forecast = max(Plătit, Angajat, Estimare). '
                  'Sursa: Kralik - Project Plan v0.7.xlsx, foaia Contract-Factura.').font = Font(name=FONT, size=9, italic=True)
    for col, w in zip(range(1, 8), (12, 10, 9, 22, 48, 20, 12)):
        ws.column_dimensions[L(col)].width = w
    for col in range(c_bud, len(hdr) + 1):
        ws.column_dimensions[L(col)].width = 14
    ws.freeze_panes = 'F4'
    ws.auto_filter.ref = f'A3:{L(len(hdr))}{r - 2}'

    # sheet order: summaries first, then years in order (like the reference workbook)
    order_titles = ['Sumar pe ani', 'Portofoliu'] + [str(y) for y in past] + [f'{fy}-Sumar', f'{fy}-Buget', f'{fy}-Exec']
    wb._sheets = [wb[t] for t in order_titles] + [w for w in wb._sheets if w.title not in order_titles]
    wb.active = 0

    wb.calculation.fullCalcOnLoad = True
    wb.save(out)
    print('Wrote', out)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
