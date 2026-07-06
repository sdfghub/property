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

  const logCashState = async (label: string) => {
    const accs = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const txs = await request('GET', `/communities/${communityId}/cash-tx`, undefined, token)
    const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const fundById = new Map<string, { code?: string; name?: string }>(
      (Array.isArray(funds) ? funds : []).map((f: any) => [f.id, { code: f.code, name: f.name }]),
    )
    const rows = (Array.isArray(accs) ? accs : []).map((a: any) => {
      const accTx = (Array.isArray(txs) ? txs : []).filter((t: any) => t.accountId === a.id)
      const inflow = accTx.filter((t: any) => t.direction === 'IN').reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
      const outflow = accTx.filter((t: any) => t.direction === 'OUT').reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
      return {
        id: a.id,
        code: a.code,
        currency: a.currency,
        txCount: accTx.length,
        inflow,
        outflow,
        net: inflow - outflow,
      }
    })
    console.log(label)
    console.table(rows)

    const fundRows = new Map<string, any>()
    ;(Array.isArray(txs) ? txs : []).forEach((t: any) => {
      const acc = (Array.isArray(accs) ? accs : []).find((a: any) => a.id === t.accountId)
      if (!acc) return
      const key = `${t.accountId}:${t.fundId ?? 'UNALLOCATED'}`
      const info = fundById.get(t.fundId) || {}
      if (!fundRows.has(key)) {
        fundRows.set(key, {
          accountId: acc.id,
          accountCode: acc.code,
          fundId: t.fundId ?? null,
          fundCode: info.code ?? (t.fundId ? null : 'UNALLOCATED'),
          fundName: info.name ?? (t.fundId ? null : 'Unallocated'),
          txCount: 0,
          inflow: 0,
          outflow: 0,
          net: 0,
        })
      }
      const row = fundRows.get(key)
      row.txCount += 1
      if (t.direction === 'IN') row.inflow += Number(t.amount || 0)
      if (t.direction === 'OUT') row.outflow += Number(t.amount || 0)
      row.net = row.inflow - row.outflow
    })
    const fundTable = Array.from(fundRows.values())
    console.log(`${label} (by fund)`)
    console.table(fundTable)
  }

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
    const m = f.match(/(meters|actuals)-(\d{4}-\d{2})/i)
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

  if (Array.isArray(def.accounts) && def.accounts.length) {
    console.log('Ensuring cash accounts...')
    const existingAccounts = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const accountByCode = new Map<string, any>(
      (Array.isArray(existingAccounts) ? existingAccounts : []).map((a: any) => [a.code, a]),
    )
    for (const acc of def.accounts) {
      if (accountByCode.has(acc.code)) continue
      const created = await request(
        'POST',
        `/communities/${communityId}/cash-accounts`,
        { code: acc.code, name: acc.name, type: acc.type, currency: acc.currency },
        token,
      )
      accountByCode.set(acc.code, created)
    }
    console.log(`✔ Cash accounts ensured (${accountByCode.size})`)

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

  console.log('Creating expense types...')
  for (const exp of def.expenseSplits || []) {
    const splits = Array.isArray(exp.splits) ? exp.splits : []
    const firstAlloc = splits.find((s: any) => s?.allocation)?.allocation
    const method = String(firstAlloc?.ruleCode || firstAlloc?.method || '').trim()
    if (!method) {
      throw new Error(`Expense type ${exp.expenseTypeCode} missing allocation method`)
    }
    await request(
      'POST',
      `/communities/${communityId}/expense-types`,
      {
        code: exp.expenseTypeCode,
        name: exp.name || exp.expenseTypeCode,
        method,
        fundCode: 'EXPENSES',
        splitTemplate: splits,
      },
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
    const existingFunds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const existingByCode = new Map<string, any>(
      (Array.isArray(existingFunds) ? existingFunds : []).map((f: any) => [f.code, f]),
    )
    for (const f of funds || []) {
      const code = String(f?.code || '').trim()
      if (!code || existingByCode.has(code)) continue
      await request('POST', `/communities/${communityId}/funds`, f, token)
    }
    const refreshed = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const refreshedByCode = new Map<string, any>(
      (Array.isArray(refreshed) ? refreshed : []).map((f: any) => [f.code, f]),
    )
    const missingCodes = (funds || [])
      .map((f: any) => String(f?.code || '').trim())
      .filter((code: string) => code && !refreshedByCode.has(code))
    assert(!missingCodes.length, `funds missing after creation: ${missingCodes.join(', ')}`)
  }

  if (Array.isArray(def.fundChargeOpenings) && def.fundChargeOpenings.length) {
    console.log('Posting fund opening charge balances (unit-level)...')
    const rows: any[] = []
    for (const block of def.fundChargeOpenings) {
      const fundCode = String(block?.fundCode || '').trim()
      const openingPeriodCode = String(block?.openingPeriodCode || '').trim()
      assert(fundCode, 'fundCode missing for fundChargeOpenings')
      assert(openingPeriodCode, `openingPeriodCode missing for fundChargeOpenings ${fundCode}`)
      const lines = Array.isArray(block?.lines) ? block.lines : []
      for (const line of lines) {
        const unitCode = String(line?.unitCode || '').trim()
        assert(unitCode, `unitCode missing for fundChargeOpenings ${fundCode}`)
        rows.push({
          communityId,
          periodCode: openingPeriodCode,
          unitCode,
          fundCode,
          amount: Number(line?.amount ?? 0),
          currency: line?.currency ?? 'RON',
        })
      }
    }
    if (rows.length) {
      await request('POST', `/admin/opening-balances/units`, { rows }, token)
      console.log(`✔ Fund opening charges posted (${rows.length})`)
    }
  }

  if (Array.isArray(def.accounts) && def.accounts.length) {
    console.log('Posting cash opening balances...')
    const existingAccounts = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const accountByCode = new Map<string, any>(
      (Array.isArray(existingAccounts) ? existingAccounts : []).map((a: any) => [a.code, a]),
    )
    const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const fundByCode = new Map<string, any>(
      (Array.isArray(funds) ? funds : []).map((f: any) => [f.code, f]),
    )
    for (const acc of def.accounts) {
      const stored = accountByCode.get(acc.code)
      assert(stored?.id, `cash account not found for code ${acc.code}`)
      assert(Array.isArray(acc.openings), `openings missing for account ${acc.code}`)
      for (const opening of acc.openings) {
        const openingBalance = Number(opening.openingBalance ?? 0)
        if (!Number.isFinite(openingBalance) || openingBalance === 0) continue
        assert(opening.openingPeriodCode, `openingPeriodCode missing for account ${acc.code}`)
        assert(opening.fundCode, `fundCode missing for account ${acc.code}`)
        assert(
          opening.openingPeriodCode === periodCode,
          `openingPeriodCode ${opening.openingPeriodCode} does not match def.period.code ${periodCode}`,
        )
        const fund = fundByCode.get(opening.fundCode)
        assert(fund?.id, `fund not found for code ${opening.fundCode} (account ${acc.code})`)
        const direction = openingBalance >= 0 ? 'IN' : 'OUT'
        const amount = Math.abs(openingBalance)
        await request(
          'POST',
          `/communities/${communityId}/cash-tx`,
          {
            accountId: stored.id,
            fundId: fund.id,
            amount,
            currency: acc.currency,
            direction,
            kind: 'ADJUSTMENT',
            refType: 'OPENING_BALANCE',
            refId: `${acc.code}:${opening.openingPeriodCode}:${opening.fundCode}`,
            memo: 'Opening balance',
            ts: periodStart,
          },
          token,
        )
      }
    }
    console.log('✔ Cash opening balances posted')
  }

  const billTplPath = path.join(communityDir, 'bill-templates.json')
  const billTemplatesByCode = new Map<string, { items: any[] }>()
  if (fs.existsSync(billTplPath)) {
    console.log('Creating bill templates...')
    const body = readJson(billTplPath)
    const templates = normalizeBillTemplates(body)
    for (const tpl of templates) {
      await request('POST', `/communities/${communityId}/periods/${periodCode}/bill-templates`, tpl, token)
    }
    for (const tpl of templates) {
      const code = String(tpl?.code || '').trim()
      if (!code) continue
      const items = Array.isArray(tpl?.template?.items) ? tpl.template.items : []
      billTemplatesByCode.set(code, { items })
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
    const allPeriodsForActuals = await request('GET', `/communities/${communityId}/periods`, undefined, token)
    const periodRows = Array.isArray(allPeriodsForActuals) ? allPeriodsForActuals : []
    console.log(`Periods snapshot before actuals ${pCode}:`)
    console.table(
      periodRows.map((p: any) => ({
        code: p.code,
        status: p.status,
        seq: p.seq,
        startDate: p.startDate,
        endDate: p.endDate,
        preparedAt: p.preparedAt,
        closedAt: p.closedAt,
      })),
    )
    const periodRow = periodRows.find((p: any) => p.code === pCode)
    assert(periodRow, `Period ${pCode} not found`)
    if (periodRow.status !== 'OPEN') {
      console.log(`⚠️ Period ${pCode} is not OPEN (status=${periodRow.status}). Actuals submission will likely fail.`)
    }

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

    const actualsPath = path.join(communityDir, `actuals-${pCode}.json`)
    if (fs.existsSync(actualsPath)) {
      console.log(`Submitting actuals ${path.basename(actualsPath)} (period=${pCode}, status=${periodRow.status})...`)
      const actuals = readJson(actualsPath)
      const items = Array.isArray(actuals?.items) ? actuals.items : []
      if (actuals?.periodCode && actuals.periodCode !== pCode) {
        throw new Error(`actuals periodCode mismatch: expected ${pCode}, got ${actuals.periodCode}`)
      }
      console.log(
        `Actuals items: ${items.length}, templates available: ${billTemplatesByCode.size}, meter templates: ${
          fs.existsSync(meterTplPath) ? 'yes' : 'no'
        }`,
      )
      const byTemplate = new Map<string, Record<string, any>>()
      for (const it of items) {
        const templateCode = String(it?.templateCode || '').trim()
        const detailKey = String(it?.detailKey || '').trim()
        const amount = Number(it?.amount)
        if (!templateCode || !detailKey) {
          throw new Error(`actuals item requires templateCode and detailKey`)
        }
        if (!Number.isFinite(amount)) {
          throw new Error(`actuals item ${templateCode}/${detailKey} has invalid amount`)
        }
        const tpl = billTemplatesByCode.get(templateCode)
        if (!tpl) {
          throw new Error(`actuals item references unknown template: ${templateCode}`)
        }
        const itemDef = tpl.items.find((x: any) => x?.key === detailKey)
        if (!itemDef || (itemDef.kind !== 'charge' && itemDef.kind !== 'expense')) {
          throw new Error(`actuals item ${templateCode}/${detailKey} does not match a charge item`)
        }
        const map = byTemplate.get(templateCode) || {}
        if (map[detailKey] != null) {
          throw new Error(`duplicate actuals detailKey for template ${templateCode}: ${detailKey}`)
        }
        map[detailKey] = amount
        const invoiceNumber = it?.invoiceNumber
        const invoiceDate = it?.invoiceDate
        const invoiceNet = it?.invoiceNet
        const invoiceVat = it?.invoiceVat
        const invoiceGross = it?.invoiceGross
        const serviceStartPeriod = it?.serviceStartPeriod
        const serviceEndPeriod = it?.serviceEndPeriod
        if (invoiceNumber != null) {
          if (map.invoiceNumber != null && map.invoiceNumber !== invoiceNumber) {
            throw new Error(`conflicting invoiceNumber for template ${templateCode}`)
          }
          map.invoiceNumber = invoiceNumber
        }
        if (invoiceDate != null) {
          if (map.invoiceDate != null && map.invoiceDate !== invoiceDate) {
            throw new Error(`conflicting invoiceDate for template ${templateCode}`)
          }
          map.invoiceDate = invoiceDate
        }
        if (invoiceNet != null) {
          if (map.invoiceNet != null && map.invoiceNet !== invoiceNet) {
            throw new Error(`conflicting invoiceNet for template ${templateCode}`)
          }
          map.invoiceNet = invoiceNet
        }
        if (invoiceVat != null) {
          if (map.invoiceVat != null && map.invoiceVat !== invoiceVat) {
            throw new Error(`conflicting invoiceVat for template ${templateCode}`)
          }
          map.invoiceVat = invoiceVat
        }
        if (invoiceGross != null) {
          if (map.invoiceGross != null && map.invoiceGross !== invoiceGross) {
            throw new Error(`conflicting invoiceGross for template ${templateCode}`)
          }
          map.invoiceGross = invoiceGross
        }
        if (serviceStartPeriod != null) {
          if (map.serviceStartPeriod != null && map.serviceStartPeriod !== serviceStartPeriod) {
            throw new Error(`conflicting serviceStartPeriod for template ${templateCode}`)
          }
          map.serviceStartPeriod = serviceStartPeriod
        }
        if (serviceEndPeriod != null) {
          if (map.serviceEndPeriod != null && map.serviceEndPeriod !== serviceEndPeriod) {
            throw new Error(`conflicting serviceEndPeriod for template ${templateCode}`)
          }
          map.serviceEndPeriod = serviceEndPeriod
        }
        byTemplate.set(templateCode, map)
      }
      for (const [templateCode, values] of byTemplate.entries()) {
        await request(
          'POST',
          `/communities/${communityId}/periods/${pCode}/bill-templates/${templateCode}/state`,
          { state: 'SUBMITTED', values },
          token,
        )
      }
      console.log(`✔ Actuals submitted (${items.length})`)
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

    // After closing this period, create the next one (OPEN) for payments.
    const m = pCode.match(/^(\d{4})-(\d{2})$/)
    assert(m, `Invalid period code format: ${pCode}`)
    const year = Number(m[1])
    const month = Number(m[2])
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const nextCode = `${nextYear}-${String(nextMonth).padStart(2, '0')}`
    const openAfter = await request('GET', `/communities/${communityId}/periods/open`, undefined, token)
    if (!Array.isArray(openAfter) || openAfter.length === 0) {
      console.log(`Creating next open period ${nextCode} for payments...`)
      await request('POST', `/communities/${communityId}/periods/create`, { code: nextCode }, token)
    }

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

  console.log('Fetching vendor invoices...')
  const invoices = await request('GET', `/communities/${communityId}/invoices`, undefined, token)
  const invoiceRows = (Array.isArray(invoices) ? invoices : []).map((inv: any) => ({
    id: inv.id,
    number: inv.number ?? null,
    vendor: inv.vendor?.name ?? null,
    issueDate: inv.issueDate ?? null,
    currency: inv.currency ?? null,
    gross: inv.gross ?? null,
    funds: Array.isArray(inv.fundInvoices)
      ? inv.fundInvoices.map((f: any) => `${f.fund?.code ?? f.fundId}:${f.amount ?? ''}`).join(', ')
      : '',
  }))
  console.table(invoiceRows)
  if (invoiceRows.length >= 2) {
    console.log('Creating vendor payments for first two invoices...')
    let accounts = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    if (!Array.isArray(accounts) || accounts.length === 0) {
      const created = await request(
        'POST',
        `/communities/${communityId}/cash-accounts`,
        { code: 'MAIN', name: 'Main account', type: 'BANK', currency: 'RON' },
        token,
      )
      accounts = [created]
    }
    const accountId = accounts?.[0]?.id ?? null
    const inv1 = (Array.isArray(invoices) ? invoices[0] : null)
    const inv2 = (Array.isArray(invoices) ? invoices[1] : null)
    const gross1 = Number(inv1?.gross)
    const gross2 = Number(inv2?.gross)
    assert(Number.isFinite(gross1) && gross1 > 0, 'First invoice gross is invalid')
    assert(Number.isFinite(gross2) && gross2 > 0, 'Second invoice gross is invalid')
    await logCashState('Cash accounts before vendor payments')
    await request(
      'POST',
      `/communities/${communityId}/invoices/${inv1.id}/payments`,
      { amount: gross1 * 0.5, currency: inv1.currency || 'RON', method: 'BANK', accountId },
      token,
    )
    await request(
      'POST',
      `/communities/${communityId}/invoices/${inv2.id}/payments`,
      { amount: gross2, currency: inv2.currency || 'RON', method: 'BANK', accountId },
      token,
    )
    await logCashState('Cash accounts after vendor payments')
    console.log('✔ Vendor payments created')

    const invoicesAfter = await request('GET', `/communities/${communityId}/invoices`, undefined, token)
    const invoiceRowsAfter = (Array.isArray(invoicesAfter) ? invoicesAfter : []).map((inv: any) => ({
      id: inv.id,
      number: inv.number ?? null,
      vendor: inv.vendor?.name ?? null,
      currency: inv.currency ?? null,
      gross: inv.gross ?? null,
      paid: inv.paid ?? null,
      due: inv.due ?? null,
    }))
    console.log('Invoices after payments (with due)')
    console.table(invoiceRowsAfter)
  } else {
    console.log('Skipping vendor payments: fewer than 2 invoices')
  }
  await logCashState('Cash accounts final balances')

  console.log('Creating BE payment for Ap 20 (expenses + partial other fund)...')
  const bes = await request('GET', `/communities/${communityId}/billing-entities`, undefined, token)
  const be20 = (Array.isArray(bes) ? bes : []).find((b: any) => b.code === 'Ap 20')
  assert(be20?.id, 'Billing entity Ap 20 not found')
  const unitsList = await request('GET', `/communities/${communityId}/units`, undefined, token)
  const unit20 = (Array.isArray(unitsList) ? unitsList : []).find((u: any) => u.code === '20')
  assert(unit20?.id, 'Unit code 20 not found')
  console.log(`Target unit for BE payment: ${unit20.code} (${unit20.id})`)
  const openPeriodList = await request('GET', `/communities/${communityId}/periods/open`, undefined, token)
  const openPeriod = Array.isArray(openPeriodList) ? openPeriodList[openPeriodList.length - 1] : openPeriodList
  assert(openPeriod?.code, 'No open period found for payments')
  const paymentPeriodCode = openPeriod.code
  console.log(`Payment period (OPEN): ${paymentPeriodCode}`)
  const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
  const expenseFund = (Array.isArray(funds) ? funds : []).find((f: any) => f.code === 'EXPENSES')
  assert(expenseFund?.id, 'EXPENSES fund not found')
  const otherFund = (Array.isArray(funds) ? funds : []).find((f: any) => f.code && f.code !== 'EXPENSES')
  assert(otherFund?.id, 'No secondary fund found for partial payment')
  const roundDown4 = (value: number) => Math.floor(value * 10000) / 10000
  const openExpenses = await request(
    'GET',
    `/communities/${communityId}/payments/open-charges?billingEntityId=${be20.id}&fundId=${expenseFund.id}&unitId=${unit20.id}`,
    undefined,
    token,
  )
  const openOther = await request(
    'GET',
    `/communities/${communityId}/payments/open-charges?billingEntityId=${be20.id}&fundId=${otherFund.id}&unitId=${unit20.id}`,
    undefined,
    token,
  )
  const expensesAvailable = Number(openExpenses?.totalAvailable || 0)
  const otherAvailable = Number(openOther?.totalAvailable || 0)
  console.log('Open charge items for unit 20 (expenses fund)')
  console.table((openExpenses?.items || []).slice(0, 10))
  console.log(`Open charges total (expenses): ${expensesAvailable}`)
  console.log('Open charge items for unit 20 (other fund)')
  console.table((openOther?.items || []).slice(0, 10))
  console.log(`Open charges total (other): ${otherAvailable}`)
  console.log('Ap 20 open-charge availability for unit 20 (by fund)')
  console.table([
    { fundId: expenseFund.id, fundCode: expenseFund.code, fundName: expenseFund.name, available: expensesAvailable },
    { fundId: otherFund.id, fundCode: otherFund.code, fundName: otherFund.name, available: otherAvailable },
  ])
  assert(expensesAvailable > 0, 'No EXPENSES open charges found for Ap 20 unit 20')
  assert(otherAvailable > 0, 'No secondary fund open charges found for Ap 20 unit 20')
  const epsilon = 0.0001
  const payOther = roundDown4(Math.max(0, otherAvailable * 0.5 - epsilon))
  const payExpenses = roundDown4(Math.max(0, expensesAvailable - epsilon))
  const payAmount = roundDown4(payExpenses + payOther)
  const accountList = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
  const bankAcc = (Array.isArray(accountList) ? accountList : []).find((a: any) => a.code === 'BANK_MAIN')
  assert(bankAcc?.id, 'BANK_MAIN cash account not found')
  await request(
    'POST',
    `/communities/${communityId}/payments`,
    {
      billingEntityId: be20.id,
      amount: payAmount,
      currency: 'RON',
      method: 'BANK',
      accountId: bankAcc.id,
      allocationSpec: [
        { amount: payExpenses, fundId: expenseFund.id, unitId: unit20.id, billingEntityId: be20.id },
        { amount: payOther, fundId: otherFund.id, unitId: unit20.id, billingEntityId: be20.id },
      ],
    },
    token,
  )
  console.log(`✔ BE payment posted for Ap 20 (amount=${payAmount})`)

  const openExpensesAfter = await request(
    'GET',
    `/communities/${communityId}/payments/open-charges?billingEntityId=${be20.id}&fundId=${expenseFund.id}&unitId=${unit20.id}`,
    undefined,
    token,
  )
  const openOtherAfter = await request(
    'GET',
    `/communities/${communityId}/payments/open-charges?billingEntityId=${be20.id}&fundId=${otherFund.id}&unitId=${unit20.id}`,
    undefined,
    token,
  )
  const expensesAvailableAfter = Number(openExpensesAfter?.totalAvailable || 0)
  const otherAvailableAfter = Number(openOtherAfter?.totalAvailable || 0)
  console.log(`Ap 20 open-charge availability for unit 20 after payment (period ${paymentPeriodCode})`)
  console.table([
    { fundId: expenseFund.id, fundCode: expenseFund.code, fundName: expenseFund.name, available: expensesAvailableAfter },
    { fundId: otherFund.id, fundCode: otherFund.code, fundName: otherFund.name, available: otherAvailableAfter },
  ])

  const petty = (def.accounts || []).find((a: any) => a.type === 'PETTY')
  const bank = (def.accounts || []).find((a: any) => a.type === 'BANK')
  if (petty && bank) {
    console.log('Moving all money from petty cash to bank...')
    const accs = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const pettyAcc = (Array.isArray(accs) ? accs : []).find((a: any) => a.code === petty.code)
    const bankAcc = (Array.isArray(accs) ? accs : []).find((a: any) => a.code === bank.code)
    assert(pettyAcc?.id, `Cash account not found for petty code ${petty.code}`)
    assert(bankAcc?.id, `Cash account not found for bank code ${bank.code}`)
    const fundsForTransfer = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const transferFundCode = bank.defaultFundCode || petty.defaultFundCode
    assert(transferFundCode, 'defaultFundCode missing for petty/bank transfer')
    const transferFund = (Array.isArray(fundsForTransfer) ? fundsForTransfer : []).find((f: any) => f.code === transferFundCode)
    assert(transferFund?.id, `fund not found for code ${transferFundCode}`)
    const txs = await request('GET', `/communities/${communityId}/cash-tx`, undefined, token)
    const pettyTx = (Array.isArray(txs) ? txs : []).filter((t: any) => t.accountId === pettyAcc.id)
    const pettyIn = pettyTx.filter((t: any) => t.direction === 'IN').reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
    const pettyOut = pettyTx.filter((t: any) => t.direction === 'OUT').reduce((s: number, t: any) => s + Number(t.amount || 0), 0)
    const pettyNet = pettyIn - pettyOut
    if (pettyNet > 0) {
      await request(
        'POST',
        `/communities/${communityId}/cash-tx`,
        {
          accountId: pettyAcc.id,
          fundId: transferFund.id,
          amount: pettyNet,
          currency: pettyAcc.currency,
          direction: 'OUT',
          kind: 'TRANSFER',
          refType: 'TRANSFER',
          refId: `${petty.code}->${bank.code}`,
          memo: 'Move petty cash to bank',
        },
        token,
      )
      await request(
        'POST',
        `/communities/${communityId}/cash-tx`,
        {
          accountId: bankAcc.id,
          fundId: transferFund.id,
          amount: pettyNet,
          currency: bankAcc.currency,
          direction: 'IN',
          kind: 'TRANSFER',
          refType: 'TRANSFER',
          refId: `${petty.code}->${bank.code}`,
          memo: 'Move petty cash to bank',
        },
        token,
      )
    }
    await logCashState('Cash accounts after petty transfer')
  }
  const invoiceTotal = invoiceRows.reduce((s: number, r: any) => s + (Number(r.gross) || 0), 0)
  console.log(`Total invoices: ${invoiceRows.length}`)
  console.log(`Total invoice gross: ${invoiceTotal}`)

  console.log('✅ UI-style reset/import complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
