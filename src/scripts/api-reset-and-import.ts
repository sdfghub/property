import fs from 'fs'
import path from 'path'

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

// Auto-import scadență convention: due = 20th of the month FOLLOWING the period.
// (In normal use the association admin sets the due date explicitly; here we set it so the
// 30-day penalty grace applies instead of penalties accruing from the first month.)
const dueDate20thNextMonth = (periodCode: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(periodCode)
  if (!m) throw new Error(`Invalid period code for due date: ${periodCode}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const ny = mo === 12 ? y + 1 : y
  const nm = mo === 12 ? 1 : mo + 1
  return `${ny}-${String(nm).padStart(2, '0')}-20`
}

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

async function main() {
  assert(email && password, 'Set API_EMAIL and API_PASSWORD')
  const communityDirArg = process.argv[2] || './data/LOTUS-TM'
  const root = process.cwd()
  const communityDir = path.isAbsolute(communityDirArg) ? communityDirArg : path.join(root, communityDirArg)
  assert(fs.existsSync(communityDir), `Community data folder not found: ${communityDir}`)

  baseUrl = await detectBaseUrl()
  console.log(`Base URL: ${baseUrl}`)

  console.log('Logging in...')
  const auth = await request('POST', '/auth/login', { email, password })
  const token = auth?.accessToken
  assert(token, 'Login failed: missing accessToken')

  const defPath = path.join(communityDir, 'def.json')
  assert(fs.existsSync(defPath), `Missing def.json in ${communityDir}`)
  const def = readJson(defPath)
  const communityId = def?.id ?? path.basename(communityDir)

  console.log(`Community: ${communityId}`)

  const logCashState = async (label: string) => {
    const accs = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const txs = await request('GET', `/communities/${communityId}/cash-tx`, undefined, token)
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
  }

  const doWipe = (process.env.WIPE ?? 'true') !== 'false'
  if (doWipe) {
    console.log('Wiping community data (API)...')
    await request('POST', `/admin/communities/${communityId}/wipe`, {}, token)
    console.log('✔ Wiped')
  }

  console.log('Importing community definition (API)...')
  await request('POST', '/admin/communities/import', { def }, token)
  console.log('✔ Community imported')

  const fundsPath = path.join(communityDir, 'funds.json')
  if (fs.existsSync(fundsPath)) {
    console.log('Importing funds (API)...')
    const funds = readJson(fundsPath)
    await request('POST', `/communities/${communityId}/funds/import`, funds, token)
    console.log(`✔ Funds imported (${Array.isArray(funds) ? funds.length : 'n/a'})`)
  }

  const openingPath = path.join(communityDir, 'opening-balances.csv')
  if (fs.existsSync(openingPath)) {
    console.log('Importing opening balances (API)...')
    const rows = parseCsvRows(openingPath).map((cols) => {
      const [communityId, periodCode, beCode, maybeLegacy, amount, currency] = cols
      const amt = cols.length >= 6 ? amount : maybeLegacy
      const cur = cols.length >= 6 ? currency : amount
      return { communityId, periodCode, beCode, amount: Number(amt), currency: cur }
    })
    await request('POST', `/admin/opening-balances`, { rows }, token)
    console.log(`✔ Opening balances imported (${rows.length})`)
  }

  const openingUnitsPath = path.join(communityDir, 'opening-balances-units.csv')
  if (fs.existsSync(openingUnitsPath)) {
    console.log('Importing opening balances per unit (API)...')
    const rows = parseCsvRows(openingUnitsPath).map((cols) => {
      const [communityId, periodCode, unitCode, maybeLegacy, amount, currency] = cols
      const amt = cols.length >= 6 ? amount : maybeLegacy
      const cur = cols.length >= 6 ? currency : amount
      return { communityId, periodCode, unitCode, amount: Number(amt), currency: cur }
    })
    await request('POST', `/admin/opening-balances/units`, { rows }, token)
    console.log(`✔ Opening balances (unit) imported (${rows.length})`)
  }

  const billTplPath = path.join(communityDir, 'bill-templates.json')
  if (fs.existsSync(billTplPath)) {
    console.log('Importing bill templates (API)...')
    const body = readJson(billTplPath)
    await request('POST', `/communities/${communityId}/bill-templates/import`, body, token)
    console.log('✔ Bill templates imported')
  }

  const meterTplPath = path.join(communityDir, 'meter-templates.json')
  if (fs.existsSync(meterTplPath)) {
    console.log('Importing meter templates (API)...')
    const body = readJson(meterTplPath)
    await request('POST', `/communities/${communityId}/meter-templates/import`, body, token)
    console.log('✔ Meter templates imported')
  }

  console.log('Ensuring expense types (API)...')
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

  const files = fs.readdirSync(communityDir)
  const periodSet = new Set<string>()
  for (const f of files) {
    const m = f.match(/(meters|actuals)-(\d{4}-\d{2})/i)
    if (m) periodSet.add(m[2])
  }
  const periods = Array.from(periodSet).sort()
  assert(periods.length > 0, 'No periods detected in data folder')

  const periodsResp = await request('GET', `/communities/${communityId}/periods`, undefined, token)
  const existingPeriods = new Set((periodsResp || []).map((p: any) => p.code))
  for (const periodCode of periods) {
    if (!existingPeriods.has(periodCode)) {
      console.log(`Creating period ${periodCode} (API)...`)
      await request('POST', `/communities/${communityId}/periods/create`, { code: periodCode }, token)
      existingPeriods.add(periodCode)
      console.log(`✔ Period created ${periodCode}`)
    }
    // Set scadența (auto-import convention: 20th of the next month) so the penalty grace applies.
    const dueDate = dueDate20thNextMonth(periodCode)
    await request('POST', `/communities/${communityId}/periods/${periodCode}/due-date`, { dueDate }, token)
    console.log(`✔ Due date set ${periodCode} → ${dueDate}`)
  }

  const billTemplatesByCode = new Map<string, { items: any[] }>()
  if (fs.existsSync(billTplPath)) {
    const billTplRaw = readJson(billTplPath)
    const templates = Array.isArray(billTplRaw) ? billTplRaw : Object.values(billTplRaw || {})
    for (const tpl of templates) {
      const code = String(tpl?.code || '').trim()
      if (!code) continue
      const items = Array.isArray(tpl?.template?.items) ? tpl.template.items : []
      billTemplatesByCode.set(code, { items })
    }
  }

  for (const periodCode of periods) {
    const meterFiles = files.filter((f) => f.startsWith(`meters-${periodCode}-`) && f.endsWith('.csv'))
    for (const mf of meterFiles) {
      const rows = parseMeterRows(path.join(communityDir, mf))
      console.log(`Importing meter readings ${mf} (rows=${rows.length})`)
      for (const row of rows) {
        await request(
          'POST',
          `/communities/${communityId}/periods/${periodCode}/meters`,
          { meterId: row.meterId, value: row.value, origin: row.origin },
          token,
        )
      }
      console.log(`✔ Meter readings imported (${mf})`)
    }

    const actualsPath = path.join(communityDir, `actuals-${periodCode}.json`)
    if (fs.existsSync(actualsPath)) {
      console.log(`Submitting actuals ${path.basename(actualsPath)} (API)...`)
      const actuals = readJson(actualsPath)
      const items = Array.isArray(actuals?.items) ? actuals.items : []
      if (actuals?.periodCode && actuals.periodCode !== periodCode) {
        throw new Error(`actuals periodCode mismatch: expected ${periodCode}, got ${actuals.periodCode}`)
      }
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
          `/communities/${communityId}/periods/${periodCode}/bill-templates/${templateCode}/state`,
          { state: 'SUBMITTED', values },
          token,
        )
      }
      console.log(`✔ Actuals submitted (${items.length})`)
    }

    // Close template instances via API (state=CLOSED)
    console.log(`Closing template instances for ${periodCode} (API)...`)
    const billTemplates = await request('GET', `/communities/${communityId}/periods/${periodCode}/bill-templates`, undefined, token)
    for (const tpl of billTemplates || []) {
      await request(
        'POST',
        `/communities/${communityId}/periods/${periodCode}/bill-templates/${tpl.code}/state`,
        { state: 'CLOSED' },
        token,
      )
    }
    const meterTemplates = await request('GET', `/communities/${communityId}/periods/${periodCode}/meter-templates`, undefined, token)
    for (const tpl of meterTemplates || []) {
      await request(
        'POST',
        `/communities/${communityId}/periods/${periodCode}/meter-templates/${tpl.code}/state`,
        { state: 'CLOSED' },
        token,
      )
    }
    console.log(`✔ Templates closed (${periodCode})`)

    console.log(`Preparing period ${periodCode} (API)...`)
    await request('POST', `/communities/${communityId}/periods/${periodCode}/prepare`, {}, token)
    console.log(`Approving period ${periodCode} (API)...`)
    await request('POST', `/communities/${communityId}/periods/${periodCode}/approve`, {}, token)

    // After closing this period, create the next one (OPEN) for payments.
    const m = periodCode.match(/^(\d{4})-(\d{2})$/)
    assert(m, `Invalid period code format: ${periodCode}`)
    const year = Number(m[1])
    const month = Number(m[2])
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    const nextCode = `${nextYear}-${String(nextMonth).padStart(2, '0')}`
    const openAfter = await request('GET', `/communities/${communityId}/periods/open`, undefined, token)
    if (!Array.isArray(openAfter) || openAfter.length === 0) {
      console.log(`Creating next open period ${nextCode} for payments...`)
      await request('POST', `/communities/${communityId}/periods/create`, { code: nextCode }, token)
      await request('POST', `/communities/${communityId}/periods/${nextCode}/due-date`, { dueDate: dueDate20thNextMonth(nextCode) }, token)
    }
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
    console.log('Skipping vendor payments: missing payment period or fewer than 2 invoices')
  }
  await logCashState('Cash accounts final balances')

  console.log('Creating BE payment for Ap 20 (expenses + partial other fund)...')
  const bes = await request('GET', `/communities/${communityId}/billing-entities`, undefined, token)
  const be20 = (Array.isArray(bes) ? bes : []).find((b: any) => b.code === 'Ap 20')
  if (!be20?.id) {
    console.log('↷ Skipping Ap 20 demo BE payment (no billing entity "Ap 20" in this community)')
  } else {
  const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
  const expenseFund = (Array.isArray(funds) ? funds : []).find((f: any) => f.code === 'EXPENSES')
  assert(expenseFund?.id, 'EXPENSES fund not found')
  const otherFund = (Array.isArray(funds) ? funds : []).find((f: any) => f.code && f.code !== 'EXPENSES')
  assert(otherFund?.id, 'No secondary fund found for partial payment')
  const fin = await request('GET', `/communities/be/${be20.id}/periods/${periodCode}/financials`, undefined, token)
  const details = (fin?.ledgerEntries || [])
    .filter((le: any) => le?.kind === 'CHARGE')
    .flatMap((le: any) =>
      (le?.details || []).map((d: any) => ({
        fundId: d.fundId ?? null,
        amount: Number(d.amount || 0),
      })),
    )
  const fundById = new Map<string, { code?: string; name?: string }>(
    (Array.isArray(funds) ? funds : []).map((f: any) => [f.id, { code: f.code, name: f.name }]),
  )
  const chargeRows = details
    .filter((d: any) => d.fundId)
    .map((d: any) => {
      const info = fundById.get(d.fundId) || {}
      return {
        fundId: d.fundId,
        fundCode: info.code ?? null,
        fundName: info.name ?? null,
        amount: d.amount,
      }
    })
  console.log('Ap 20 CHARGE details by fund (before payment)')
  console.table(chargeRows)
  const sumByFund = new Map<string, number>()
  details.forEach((d: any) => {
    if (!d.fundId) return
    sumByFund.set(d.fundId, (sumByFund.get(d.fundId) || 0) + Number(d.amount || 0))
  })
  const expensesTotal = sumByFund.get(expenseFund.id) || 0
  const otherTotal = sumByFund.get(otherFund.id) || 0
  assert(expensesTotal > 0, 'No EXPENSES fund charges found for Ap 20')
  assert(otherTotal > 0, 'No secondary fund charges found for Ap 20')
  const payOther = Number((otherTotal * 0.5).toFixed(4))
  const payExpenses = Number(expensesTotal.toFixed(4))
  const payAmount = Number((payExpenses + payOther).toFixed(4))
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
        { amount: payExpenses, fundId: expenseFund.id, billingEntityId: be20.id },
        { amount: payOther, fundId: otherFund.id, billingEntityId: be20.id },
      ],
    },
    token,
  )
  console.log(`✔ BE payment posted for Ap 20 (amount=${payAmount})`)
  }

  const petty = (def.accounts || []).find((a: any) => a.type === 'PETTY')
  const bank = (def.accounts || []).find((a: any) => a.type === 'BANK')
  if (petty && bank) {
    console.log('Moving all money from petty cash to bank...')
    const accs = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
    const pettyAcc = (Array.isArray(accs) ? accs : []).find((a: any) => a.code === petty.code)
    const bankAcc = (Array.isArray(accs) ? accs : []).find((a: any) => a.code === bank.code)
    assert(pettyAcc?.id, `Cash account not found for petty code ${petty.code}`)
    assert(bankAcc?.id, `Cash account not found for bank code ${bank.code}`)
    const funds = await request('GET', `/communities/${communityId}/funds`, undefined, token)
    const transferFundCode = bank.defaultFundCode || petty.defaultFundCode
    assert(transferFundCode, 'defaultFundCode missing for petty/bank transfer')
    const transferFund = (Array.isArray(funds) ? funds : []).find((f: any) => f.code === transferFundCode)
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

  console.log('✅ API reset/import complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
