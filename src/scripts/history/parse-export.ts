/**
 * Generic parser for an external history export → normalized per-month, per-unit dataset.
 * Reusable: driven entirely by <communityDir>/history-mapping.json (no hardcoded association logic).
 *
 * Inputs (in <communityDir>/history/):
 *   matrix.csv    — wide monthly matrix: Luna,Categorie,Serviciu-Grup,Serviciu,Stare,Stare-Operational,Cheltuiala,<unit cols…>,Total
 *   penalties.csv — per-month penalty schedule: Luna,Data Afisare,Afisare-Delta,Data Scadenta,Scadenta-Delta,Rata Penalitati
 *   history-mapping.json — unit + metric mapping (see data/Kralik/history-mapping.json)
 *
 * Run:  npm run history:parse -- ./data/Kralik      (prints a validation report; --json dumps the dataset)
 */
import fs from 'fs'
import path from 'path'

function parseCsvLine(l: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (const ch of l) {
    if (ch === '"') q = !q
    else if (ch === ',' && !q) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}
const readLines = (p: string) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((x) => x.length)
const num = (s: string) => {
  if (s == null) return 0
  const t = String(s).replace(/\s/g, '').replace('%', '')
  if (t === '' || t === '-' || t === '—') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
function lunaToCode(luna: string): string | null {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(luna.trim())
  if (!m) return null
  const mm = MONTHS[m[1].toLowerCase()]
  if (!mm) return null
  return `20${m[2]}-${mm}`
}
function parseDate(s: string): string | null {
  const t = (s || '').trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t) // m/d/yyyy
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
  return null
}

export type UnitMonth = {
  charges: Record<string, number>       // serviceCode -> amount (kind=charge)
  funds: Record<string, number>         // fundCode -> monthly contribution (kind=fund)
  penPosted: number                      // Penalizări-Curente
  penArrears: number                     // Penalizări-Restante
  soldByFund: Record<string, number>     // fundCode -> outstanding balance (kind=balance role=sold; EXPENSES arrears too)
  arrearsByFund: Record<string, number>  // fundCode -> arrears (kind=balance role=arrears)
  drivers: Record<string, number>        // cpi / residents / water_cold
}
export type MonthData = {
  code: string
  dueDate: string | null
  penaltyRate: number
  units: Record<string, UnitMonth>       // unitCode -> data
}
export type Parsed = {
  community: string
  units: Array<{ code: string; be: string; label: string }>
  months: MonthData[]
  warnings: string[]
}

export function parseExport(communityDir: string): Parsed {
  const dir = path.resolve(communityDir)
  const mapping = JSON.parse(fs.readFileSync(path.join(dir, 'history-mapping.json'), 'utf8'))
  const def = JSON.parse(fs.readFileSync(path.join(dir, 'def.json'), 'utf8'))
  const community = def.id
  const warnings: string[] = []

  // unit label -> {code, be}
  const prefix = mapping.unitLabelPrefix ?? ''
  const byName = new Map<string, { code: string; be: string }>()
  for (const u of def.structure || []) {
    const label = String(u.name || '').startsWith(prefix) ? String(u.name).slice(prefix.length) : String(u.name || u.code)
    byName.set(label, { code: u.code, be: u.billingEntity })
  }
  const overrideCode = mapping.unitOverrides || {}
  const resolveUnit = (label: string): { code: string; be: string } | null => {
    if (overrideCode[label]) {
      const u = (def.structure || []).find((x: any) => x.code === overrideCode[label])
      return u ? { code: u.code, be: u.billingEntity } : null
    }
    return byName.get(label) ?? null
  }

  // ---- penalties.csv: month -> {dueDate, rate} ----
  const penLines = readLines(path.join(dir, 'history', 'penalties.csv'))
  const penHdr = parseCsvLine(penLines[0]).map((h) => h.trim().toLowerCase())
  const pi = (name: string) => penHdr.findIndex((h) => h.includes(name))
  const iLuna = pi('luna'), iScad = pi('scadenta') >= 0 ? penHdr.findIndex((h) => h.includes('data scadenta')) : -1, iRata = pi('rata')
  const penByMonth = new Map<string, { dueDate: string | null; rate: number }>()
  for (const line of penLines.slice(1)) {
    const c = parseCsvLine(line)
    const code = lunaToCode(c[iLuna])
    if (!code) continue
    penByMonth.set(code, { dueDate: iScad >= 0 ? parseDate(c[iScad]) : null, rate: num(c[iRata]) / 100 })
  }

  // ---- matrix.csv ----
  const mxLines = readLines(path.join(dir, 'history', 'matrix.csv'))
  const H = parseCsvLine(mxLines[0])
  const iTot = H.length - 1
  const unitCols: Array<{ i: number; label: string; unit: { code: string; be: string } | null }> = []
  for (let i = 7; i < iTot; i++) {
    const label = H[i]
    const u = resolveUnit(label)
    if (!u) warnings.push(`UNMATCHED unit column "${label}" (col ${i})`)
    unitCols.push({ i, label, unit: u })
  }

  const metricMap: Record<string, any> = mapping.metrics || {}
  const unmapped = new Set<string>()
  const months = new Map<string, MonthData>()
  const ensureMonth = (code: string): MonthData => {
    if (!months.has(code)) {
      const pen = penByMonth.get(code)
      months.set(code, { code, dueDate: pen?.dueDate ?? null, penaltyRate: pen?.rate ?? 0, units: {} })
    }
    return months.get(code)!
  }
  const ensureUnit = (m: MonthData, code: string): UnitMonth => {
    if (!m.units[code]) m.units[code] = { charges: {}, funds: {}, penPosted: 0, penArrears: 0, soldByFund: {}, arrearsByFund: {}, drivers: {} }
    return m.units[code]
  }

  const rows = mxLines.slice(1).map(parseCsvLine)
  for (const r of rows) {
    const code = lunaToCode(r[0])
    if (!code) continue
    const metric = r[6]
    const map = metricMap[metric]
    if (!map) { unmapped.add(metric); continue }
    if (map.kind === 'ignore') continue
    const M = ensureMonth(code)
    for (const uc of unitCols) {
      if (!uc.unit) continue
      const v = num(r[uc.i])
      if (v === 0 && map.kind !== 'balance') continue
      const U = ensureUnit(M, uc.unit.code)
      switch (map.kind) {
        case 'charge': U.charges[map.service] = (U.charges[map.service] || 0) + v; break
        case 'fund': U.funds[map.fund] = (U.funds[map.fund] || 0) + v; break
        case 'penalty': if (map.role === 'posted') U.penPosted += v; else U.penArrears += v; break
        case 'balance': if (map.role === 'sold') U.soldByFund[map.fund] = (U.soldByFund[map.fund] || 0) + v; else U.arrearsByFund[map.fund] = (U.arrearsByFund[map.fund] || 0) + v; break
        case 'driver': U.drivers[map.driver] = v; break
      }
    }
  }
  for (const m of unmapped) warnings.push(`UNMAPPED metric "${m}" (add to history-mapping.json)`)

  // sanity: Σ per-unit == Total for charge/fund/penalty rows
  const totalMismatches: string[] = []
  for (const r of rows) {
    const code = lunaToCode(r[0]); if (!code) continue
    const map = metricMap[r[6]]
    if (!map || !['charge', 'fund', 'penalty'].includes(map.kind)) continue
    let sum = 0
    for (const uc of unitCols) if (uc.unit) sum += num(r[uc.i])
    const tot = num(r[iTot])
    if (Math.abs(sum - tot) > 0.05) totalMismatches.push(`${code} "${r[6]}": Σunits=${sum.toFixed(2)} vs Total=${tot.toFixed(2)}`)
  }
  if (totalMismatches.length) warnings.push(`${totalMismatches.length} Σ≠Total rows (first 5): ${totalMismatches.slice(0, 5).join(' ; ')}`)

  const unitList = unitCols.filter((u) => u.unit).map((u) => ({ code: u.unit!.code, be: u.unit!.be, label: u.label }))
  return { community, units: unitList, months: [...months.values()].sort((a, b) => a.code.localeCompare(b.code)), warnings }
}

if (require.main === module) {
  const dir = process.argv[2] || './data/Kralik'
  const p = parseExport(dir)
  console.log(`community=${p.community}  months=${p.months.length} (${p.months[0]?.code}..${p.months[p.months.length - 1]?.code})  unit-columns=${p.units.length}`)
  const feb = p.months.find((m) => m.code === '2022-02')
  if (feb) {
    console.log(`\n2022-02: due=${feb.dueDate} rate=${feb.penaltyRate}`)
    const u = feb.units[p.units[0].code]
    console.log(`  unit ${p.units[0].label}: charges=${JSON.stringify(u?.charges)} penPosted=${u?.penPosted} sold=${JSON.stringify(u?.soldByFund)}`)
  }
  console.log(`\nWARNINGS (${p.warnings.length}):`)
  for (const w of p.warnings) console.log('  - ' + w)
  if (process.argv.includes('--json')) fs.writeFileSync('/tmp/kralik-parsed.json', JSON.stringify(p, null, 1))
}
