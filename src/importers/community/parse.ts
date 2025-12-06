import fs from 'fs'
import path from 'path'
import { parse as parseCsv } from 'csv-parse/sync'
import { CommunityDefJson, CommunityImportPlan, CsvRow } from './types'

const toNum = (v: any) => {
  if (v == null) return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function parseCommunity(defFolder: string): CommunityImportPlan {
  const def: CommunityDefJson = JSON.parse(fs.readFileSync(path.join(defFolder, 'def.json'), 'utf8'))
  const raw = fs.readFileSync(path.join(defFolder, 'structure.csv'), 'utf8')
  const rows: CsvRow[] = parseCsv(raw, { columns: true, skip_empty_lines: true })
    .map((r: any) => ({
      code: String(r.code ?? r['Nr. Ap.'] ?? r.unit ?? '').trim(),
      residents: r.residents ?? r['Pers. Prez.'] ?? r['pers'] ?? '',
      sqm: r.sqm ?? r['CPI (SUP)'] ?? '',
      billing_entity: r.billing_entity ?? r['billing entity'] ?? '',
      group_codes: r.group_codes ?? r['group codes'] ?? '',
      start_period: r.start_period ?? '',
      end_period: r.end_period ?? ''
    }))
    .filter((r: CsvRow) => r.code && r.code.toLowerCase() !== 'total');
    
  const units = Array.from(new Set(rows.map(r => r.code))).map(code => ({ code }))
  const memberships: CommunityImportPlan['memberships'] = []
  const periodMeasures: CommunityImportPlan['periodMeasures'] = []

  for (const r of rows) {
    const res = toNum(r.residents); const sqm = toNum(r.sqm)
    if (res != null) periodMeasures.push({ unitCode: r.code, typeCode: 'RESIDENTS', value: res })
    if (sqm != null) periodMeasures.push({ unitCode: r.code, typeCode: 'SQM', value: sqm })

    if (r.billing_entity)
      memberships.push({ unitCode: r.code, billingEntityCode: String(r.billing_entity).trim(), startPeriod: r.start_period, endPeriod: r.end_period })

    for (const g of String(r.group_codes || '').split(';').map(s => s.trim()).filter(Boolean))
      memberships.push({ unitCode: r.code, groupCode: g, startPeriod: r.start_period, endPeriod: r.end_period })
  }

  return {
    communityId: def.id,
    communityName: def.name,
    periodCode: def.period.code,
    periodStart: def.period.start,
    periodEnd: def.period.end,
    groups: def.groups ?? [],
    rules: (def.allocationRules ?? []).map(r => ({ code: r.code, method: r.method, params: r.params })),
    expenseTypes: (def.expenseTypes ?? []).map(t => ({
      code: t.code, name: t.name, ruleCode: t.ruleCode, currency: t.currency ?? 'RON',
      params: { ...(t.params ?? {}), ...(t.preset ? { preset: t.preset } : {}) }
    })),
    units,
    memberships,
    periodMeasures
  }
}
