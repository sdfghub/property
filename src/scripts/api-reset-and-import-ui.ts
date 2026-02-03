import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

type Json = Record<string, any>

const baseUrlRaw = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
let baseUrl = baseUrlRaw
const email = process.env.API_EMAIL
const password = process.env.API_PASSWORD

const assert = (cond: any, msg: string) => {
  if (!cond) {
    console.error(`❌ ${msg}`)
    process.exit(1)
  }
}

async function request(method: string, pathName: string, body?: Json, token?: string) {
  const label = `${method} ${pathName}`
  if (body) console.log(`→ ${label} body=${JSON.stringify(body).slice(0, 500)}`)
  else console.log(`→ ${label}`)
  const res = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    } as any,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  console.log(`← ${label} status=${res.status}`)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ${method} ${pathName} -> ${text}`)
  }
  return data
}

async function detectBaseUrl() {
  try {
    await request('GET', '/healthz')
    return baseUrlRaw
  } catch {
    try {
      baseUrl = `${baseUrlRaw}/api`
      await request('GET', '/healthz')
      return baseUrl
    } catch {
      baseUrl = baseUrlRaw
      return baseUrlRaw
    }
  }
}

const readJson = (filePath: string) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const parseCsvRows = (filePath: string) => {
  const raw = fs.readFileSync(filePath, 'utf8')
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.toLowerCase().startsWith('communityid'))
    .map((l) => l.split(',').map((s) => s.trim()))
}

const parseMeterRows = (filePath: string) => {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  return raw
    .split(/\r?\n/)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((cols) => cols.length >= 3 && cols[0].toLowerCase() !== 'meterid')
    .map(([meterId, periodCode, value, origin]) => ({
      meterId,
      periodCode,
      value: Number(value),
      origin: origin?.toUpperCase() || 'METER',
    }))
}

const normalizeBillTemplates = (raw: any) =>
  Array.isArray(raw)
    ? raw.map((tpl: any) => ({ code: tpl.code, name: tpl.name, order: tpl.order, template: tpl.template }))
    : raw && typeof raw === 'object'
    ? Object.entries(raw).map(([code, tpl]: any) => ({
        code,
        name: tpl?.title || tpl?.name || code,
        order: tpl?.order ?? null,
        template: tpl,
        startPeriodCode: tpl?.startPeriodCode ?? null,
        endPeriodCode: tpl?.endPeriodCode ?? null,
      }))
    : []

const normalizeMeterTemplates = (raw: any) =>
  Array.isArray(raw)
    ? raw.map((tpl: any) => ({ code: tpl.code, name: tpl.name, order: tpl.order, template: tpl.template }))
    : raw && typeof raw === 'object'
    ? Object.entries(raw).map(([code, tpl]: any) => ({
        code,
        name: tpl?.title || tpl?.name || code,
        order: tpl?.order ?? null,
        template: tpl,
        startPeriodCode: tpl?.startPeriodCode ?? null,
        endPeriodCode: tpl?.endPeriodCode ?? null,
      }))
    : []

async function main() {
  assert(email && password, 'Set API_EMAIL and API_PASSWORD')
  const communityDirArg = process.argv[2] || './data/LOTUS-TM'
  const root = process.cwd()
  const communityDir = path.isAbsolute(communityDirArg) ? communityDirArg : path.join(root, communityDirArg)
  assert(fs.existsSync(communityDir), `Community data folder not found: ${communityDir}`)

  console.log('Resetting DB (preserve users)...')
  execSync('npm run db:flush -- --yes --preserve-users', { stdio: 'inherit' })

  baseUrl = await detectBaseUrl()
  console.log(`Base URL: ${baseUrl}`)

  console.log('Logging in...')
  const auth = await request('POST', '/auth/login', { email, password })
  let token = auth?.accessToken
  assert(token, 'Login failed: missing accessToken')

  const defPath = path.join(communityDir, 'def.json')
  assert(fs.existsSync(defPath), `Missing def.json in ${communityDir}`)
  const def = readJson(defPath)
  const communityId = def?.id ?? path.basename(communityDir)
  const periodCode = def?.period?.code
  assert(periodCode, 'def.period.code is required')

  const periodStart = def?.period?.start
  const periodEnd = def?.period?.end
  assert(periodStart && periodEnd, 'def.period.start/end are required')

  console.log(`Ensuring community ${communityId} exists...`)
  const communities = await request('GET', `/communities`, undefined, token)
  const exists = Array.isArray(communities) && communities.some((c: any) => c.id === communityId || c.code === communityId)
  if (!exists) {
    await request('POST', `/communities`, { code: communityId, name: def?.name ?? communityId, periodCode, periodStart, periodEnd }, token)
    console.log('✔ Community created')
  } else {
    console.log('✔ Community already exists')
  }

  console.log('Ensuring current user is COMMUNITY_ADMIN (invite flow)...')
  await request('POST', `/invites/community/${communityId}`, { email, role: 'COMMUNITY_ADMIN' }, token)
  const auth2 = await request('POST', '/auth/login', { email, password })
  token = auth2?.accessToken
  assert(token, 'Login failed after community invite')

  const files = fs.readdirSync(communityDir)
  const periodSet = new Set<string>()
  periodSet.add(periodCode)
  for (const f of files) {
    const m = f.match(/(meters)-(\d{4}-\d{2})/i)
    if (m) periodSet.add(m[2])
  }
  const periods = Array.from(periodSet).sort()
  assert(periods.length > 0, 'No periods detected in data folder')

  const periodsResp = await request('GET', `/communities/${communityId}/periods`, undefined, token)
  const existingPeriods = new Set((periodsResp || []).map((p: any) => p.code))
  for (const pCode of periods) {
    if (!existingPeriods.has(pCode)) {
      console.log(`Creating period ${pCode}...`)
      await request('POST', `/communities/${communityId}/periods/create`, { code: pCode }, token)
      existingPeriods.add(pCode)
    }
  }

  // Create core structure
  console.log('Creating unit groups...')
  for (const group of def.groups || []) {
    await request('POST', `/communities/${communityId}/unit-groups`, { code: group.code, name: group.name }, token)
  }

  console.log('Creating units...')
  for (const unit of def.structure || []) {
    await request('POST', `/communities/${communityId}/units`, { code: unit.code, order: unit.order ?? 0 }, token)
  }

  console.log('Creating billing entities...')
  for (const be of def.billingEntities || []) {
    await request('POST', `/communities/${communityId}/billing-entities`, { code: be.code, name: be.name, order: be.order ?? 0 }, token)
  }

  const unitGroups = await request('GET', `/communities/${communityId}/unit-groups`, undefined, token)
  const units = await request('GET', `/communities/${communityId}/units`, undefined, token)
  const billingEntities = await request('GET', `/communities/${communityId}/billing-entities`, undefined, token)
  const groupByCode = new Map((unitGroups || []).map((g: any) => [g.code, g.id]))
  const beByCode = new Map((billingEntities || []).map((b: any) => [b.code, b.id]))
  const unitByCode = new Set((units || []).map((u: any) => u.code))

  console.log('Creating SQM/RESIDENTS meters and readings...')
  for (const unit of def.structure || []) {
    if (!unitByCode.has(unit.code)) continue
    const sqmMeterId = `AUTO-SQM-${unit.code}`
    const resMeterId = `AUTO-RES-${unit.code}`
    await request(
      'POST',
      `/communities/${communityId}/meters`,
      { meterId: sqmMeterId, scopeType: 'UNIT', scopeCode: unit.code, typeCode: 'SQM', origin: 'ADMIN' },
      token,
    )
    await request(
      'POST',
      `/communities/${communityId}/meters`,
      { meterId: resMeterId, scopeType: 'UNIT', scopeCode: unit.code, typeCode: 'RESIDENTS', origin: 'ADMIN' },
      token,
    )
    for (const pCode of periods) {
      await request(
        'POST',
        `/communities/${communityId}/periods/${pCode}/meters`,
        { meterId: sqmMeterId, value: Number(unit.sqm ?? 0), origin: 'ADMIN' },
        token,
      )
      await request(
        'POST',
        `/communities/${communityId}/periods/${pCode}/meters`,
        { meterId: resMeterId, value: Number(unit.residents ?? 0), origin: 'ADMIN' },
        token,
      )
    }
  }

  console.log('Assigning unit group members...')
  for (const unit of def.structure || []) {
    if (!unitByCode.has(unit.code)) continue
    for (const groupCode of unit.groupCodes || []) {
      const groupId = groupByCode.get(groupCode)
      if (!groupId) continue
      await request(
        'POST',
        `/communities/${communityId}/unit-groups/${groupId}/members`,
        { unitCode: unit.code, startPeriodCode: periodCode },
        token,
      )
    }
  }

  console.log('Assigning billing entity members...')
  for (const unit of def.structure || []) {
    const beId = beByCode.get(unit.billingEntity)
    if (!beId) continue
    await request(
      'POST',
      `/communities/${communityId}/billing-entities/${beId}/members`,
      { unitCode: unit.code, startPeriodCode: periodCode },
      token,
    )
  }

  console.log('Creating allocation rules...')
  for (const rule of def.allocationRules || []) {
    if (!rule?.method) continue
    await request(
      'POST',
      `/communities/${communityId}/allocation-rules`,
      { method: rule.method, name: rule.name ?? null, params: rule.params ?? null },
      token,
    )
  }

  console.log('Creating split groups...')
  for (const sg of def.splitGroups || []) {
    await request('POST', `/communities/${communityId}/split-groups`, {
      code: sg.code,
      name: sg.name,
      order: sg.order ?? null,
    }, token)
  }
  const splitGroups = await request('GET', `/communities/${communityId}/split-groups`, undefined, token)
  const splitByCode = new Map((splitGroups || []).map((s: any) => [s.code, s.id]))
  for (const sg of def.splitGroups || []) {
    const splitId = splitByCode.get(sg.code)
    if (!splitId) continue
    for (const splitNodeId of sg.splitIds || []) {
      await request(
        'POST',
        `/communities/${communityId}/split-groups/${splitId}/members`,
        { splitNodeId },
        token,
      )
    }
  }

  // fund resolution is handled via fund configuration

  console.log('Creating derived meter rules...')
  for (const dm of def.derivedMeters || []) {
    await request(
      'POST',
      `/communities/${communityId}/derived-meter-rules`,
      {
        scopeType: dm.scopeType ?? 'COMMUNITY',
        sourceType: dm.sourceType,
        subtractTypes: dm.subtractTypes ?? [],
        targetType: dm.targetType,
        origin: dm.origin ?? 'DERIVED',
      },
      token,
    )
  }

  console.log('Creating aggregation rules...')
  for (const agg of def.aggregations || []) {
    await request(
      'POST',
      `/communities/${communityId}/aggregation-rules`,
      {
        targetType: agg.targetType,
        unitTypes: agg.unitTypes ?? [],
        residualType: agg.residualType ?? null,
      },
      token,
    )
  }

  console.log('Creating meters...')
  for (const m of def.meters || []) {
    await request(
      'POST',
      `/communities/${communityId}/meters`,
      {
        meterId: m.meterId ?? m.name,
        name: m.name ?? null,
        scopeType: m.scopeType,
        scopeCode: m.scopeCode,
        typeCode: m.typeCode,
        origin: m.origin ?? 'METER',
      },
      token,
    )
  }

  const fundsPath = path.join(communityDir, 'funds.json')
  if (fs.existsSync(fundsPath)) {
    console.log('Creating funds...')
    const funds = readJson(fundsPath)
    for (const f of funds || []) {
      await request('POST', `/communities/${communityId}/funds`, f, token)
    }
  }

  const billTplPath = path.join(communityDir, 'bill-templates.json')
  if (fs.existsSync(billTplPath)) {
    console.log('Creating bill templates...')
    const body = readJson(billTplPath)
    const templates = normalizeBillTemplates(body)
    for (const tpl of templates) {
      await request('POST', `/communities/${communityId}/periods/${periodCode}/bill-templates`, tpl, token)
    }
  }

  const meterTplPath = path.join(communityDir, 'meter-entry-templates.json')
  if (fs.existsSync(meterTplPath)) {
    console.log('Creating meter templates...')
    const body = readJson(meterTplPath)
    const templates = normalizeMeterTemplates(body)
    for (const tpl of templates) {
      await request('POST', `/communities/${communityId}/periods/${periodCode}/meter-templates`, tpl, token)
    }
  }

  for (const pCode of periods) {
    const meterFiles = files.filter((f) => f.startsWith(`meters-${pCode}-`) && f.endsWith('.csv'))
    for (const mf of meterFiles) {
      const rows = parseMeterRows(path.join(communityDir, mf))
      console.log(`Importing meter readings ${mf} (rows=${rows.length})`)
      for (const row of rows) {
        await request(
          'POST',
          `/communities/${communityId}/periods/${pCode}/meters`,
          { meterId: row.meterId, value: row.value, origin: row.origin },
          token,
        )
      }
    }

    console.log(`Closing template instances for ${pCode}...`)
    const billTemplates = await request('GET', `/communities/${communityId}/periods/${pCode}/bill-templates`, undefined, token)
    for (const tpl of billTemplates || []) {
      await request(
        'POST',
        `/communities/${communityId}/periods/${pCode}/bill-templates/${tpl.code}/state`,
        { state: 'CLOSED' },
        token,
      )
    }
    const meterTemplates = await request('GET', `/communities/${communityId}/periods/${pCode}/meter-templates`, undefined, token)
    for (const tpl of meterTemplates || []) {
      await request(
        'POST',
        `/communities/${communityId}/periods/${pCode}/meter-templates/${tpl.code}/state`,
        { state: 'CLOSED' },
        token,
      )
    }

    console.log(`Preparing period ${pCode}...`)
    await request('POST', `/communities/${communityId}/periods/${pCode}/prepare`, {}, token)
    console.log(`Approving period ${pCode}...`)
    await request('POST', `/communities/${communityId}/periods/${pCode}/approve`, {}, token)

    console.log(`Fetching meter readings for ${pCode}...`)
    const meters = await request('GET', `/communities/${communityId}/meters`, undefined, token)
    const meterRows: any[] = []
    for (const m of Array.isArray(meters) ? meters : []) {
      const meterId = m.meterId || m.id || m.code
      if (!meterId) continue
      let reading: any = null
      try {
        reading = await request('GET', `/communities/${communityId}/periods/${pCode}/meters/${meterId}`, undefined, token)
      } catch {
        reading = null
      }
      meterRows.push({
        meterId,
        typeCode: m.typeCode ?? null,
        scopeType: m.scopeType ?? null,
        scopeCode: m.scopeCode ?? null,
        value: reading?.value ?? null,
        origin: reading?.origin ?? null,
      })
    }
    console.table(meterRows)
    console.log(`Meters: ${meterRows.length}, with readings: ${meterRows.filter((r) => r.value != null).length}`)

    console.log(`Fetching charges per billing entity for ${pCode}...`)
    const fundsForBe = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const fundById = new Map<string, { code: string; name?: string | null }>()
    for (const f of Array.isArray(fundsForBe) ? fundsForBe : []) {
      if (!f?.id) continue
      fundById.set(String(f.id), { code: String(f.code), name: f.name ?? null })
    }
    const beSummary = await request('GET', `/communities/${communityId}/periods/${pCode}/billing-entities`, undefined, token)
    const beItems = Array.isArray(beSummary?.items) ? beSummary.items : []
    const beRows = beItems.map((b: any) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      total: Number(b.total_amount ?? 0),
    }))
    const beTotal = beRows.reduce((s: number, r: any) => s + (Number(r.total) || 0), 0)
    const fundCols = Array.from(fundById.entries()).map(([fundId, meta]) => ({
      fundId,
      code: meta.code,
    }))
    const beRowsWithFunds: any[] = []
    for (const be of beRows) {
      const row: any = { code: be.code, name: be.name, total: Number(be.total ?? 0) }
      for (const f of fundCols) row[f.code] = 0
      if (be.id) {
        const fin = await request('GET', `/communities/be/${be.id}/periods/${pCode}/financials`, undefined, token)
        const ledgerEntries = Array.isArray(fin?.ledgerEntries) ? fin.ledgerEntries : []
        for (const le of ledgerEntries) {
          const details = Array.isArray(le?.details) ? le.details : []
          for (const d of details) {
            const fundId = String(d.fundId ?? '')
            const fund = fundById.get(fundId)
            if (!fund) continue
            const col = fund.code
            row[col] = Number(row[col] ?? 0) + Number(d.amount ?? 0)
          }
        }
      }
      beRowsWithFunds.push(row)
    }
    if (beRowsWithFunds.length) {
      const totalRow: any = { code: 'TOTAL', name: '', total: 0 }
      const fundCodes = fundCols.map((f) => f.code)
      for (const f of fundCodes) totalRow[f] = 0
      for (const row of beRowsWithFunds) {
        totalRow.total += Number(row.total ?? 0)
        for (const f of fundCodes) {
          totalRow[f] += Number(row[f] ?? 0)
        }
      }
      beRowsWithFunds.push(totalRow)
    }
    console.table(beRowsWithFunds)
    console.log(`Total charges (BE): ${beTotal}`)

    console.log(`Fetching BE allocation details for ${pCode}...`)
    for (const be of beRows) {
      const alloc = await request(
        'GET',
        `/communities/${communityId}/periods/${pCode}/billing-entities/${encodeURIComponent(be.code)}/allocations`,
        undefined,
        token,
      )
      const lines = Array.isArray(alloc?.lines) ? alloc.lines : []
      console.log(`BE ${be.code} allocations (${lines.length})`)
      const rows = lines.map((l: any) => ({
          unitCode: l.unit_code ?? l.unitCode,
          amount: Number(l.amount ?? 0),
          currency: l.currency ?? null,
          expenseType: l.expense_type_code ?? l.expenseTypeCode ?? null,
          description: l.expense_description ?? l.expenseDescription ?? null,
          allocationId: l.allocation_id ?? l.allocationId ?? null,
        }))
      rows.sort((a: any, b: any) => (Number(a.amount) || 0) - (Number(b.amount) || 0))
      console.table(rows)
    }

    console.log(`Aggregating BE charges by fund for ${pCode}...`)
    const fundTotals = new Map<string, { fundId: string; fundCode?: string | null; fundName?: string | null; total: number }>()
    for (const be of beRows) {
      if (!be.id) continue
      const fin = await request('GET', `/communities/be/${be.id}/periods/${pCode}/financials`, undefined, token)
      const fundById = fin?.fundById || {}
      const ledgerEntries = Array.isArray(fin?.ledgerEntries) ? fin.ledgerEntries : []
      for (const le of ledgerEntries) {
        const details = Array.isArray(le?.details) ? le.details : []
        for (const d of details) {
          const fundId = d.fundId
          if (!fundId) continue
          const fundInfo = fundById[fundId]
          const key = fundId
          const prev = fundTotals.get(key) || {
            fundId,
            fundCode: fundInfo?.code ?? null,
            fundName: fundInfo?.name ?? null,
            total: 0,
          }
          prev.total += Number(d.amount ?? 0)
          fundTotals.set(key, prev)
        }
      }
    }
    const fundRowsAgg = Array.from(fundTotals.values()).sort((a, b) => a.fundId.localeCompare(b.fundId))
    console.table(
      fundRowsAgg.map((r) => ({
        fundId: r.fundId,
        fundCode: r.fundCode ?? '',
        fundName: r.fundName ?? '',
        total: r.total,
      })),
    )
    const fundAggTotal = fundRowsAgg.reduce((s, r) => s + (Number(r.total) || 0), 0)
    console.log(`Total charges by fund (sum of BE details): ${fundAggTotal}`)

    console.log(`Fetching charges per fund (ledger summary)...`)
    const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const fundRows: any[] = []
    for (const f of Array.isArray(funds) ? funds : []) {
      const ledger = await request('GET', `/communities/${communityId}/funds/${f.id}/ledger`, undefined, token)
      const byKind = Array.isArray(ledger?.byKind) ? ledger.byKind : []
      const chargeKind = byKind.find((k: any) => k.kind === 'CHARGE') || byKind.find((k: any) => k.kind === 'FUND_CHARGE')
      const chargeTotal = Number(chargeKind?.total ?? 0)
      fundRows.push({
        code: f.code,
        name: f.name,
        chargeTotal,
        inflow: Number(ledger?.summary?.inflow ?? 0),
        outflow: Number(ledger?.summary?.outflow ?? 0),
        net: Number(ledger?.summary?.net ?? 0),
      })
    }
    const fundTotal = fundRows.reduce((s, r) => s + (Number(r.chargeTotal) || 0), 0)
    console.table(fundRows)
    console.log(`Total charges (Funds): ${fundTotal}`)
  }

  console.log('✅ UI-style reset/import complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
