type Json = Record<string, any>

const baseUrlRaw = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')
let baseUrl = baseUrlRaw
const email = process.env.API_EMAIL
const password = process.env.API_PASSWORD
const communityCode = process.env.COMMUNITY_CODE || 'LOTUS-TM'
const templateCode = process.env.TEMPLATE_CODE || 'GAS-BILL'
const chargeValue = Number(process.env.TEMPLATE_CHARGE_VALUE || 123)

const assert = (cond: any, msg: string) => {
  if (!cond) {
    console.error(`❌ ${msg}`)
    process.exit(1)
  }
}

const printTable = (title: string, rows: Array<Record<string, any>>) => {
  console.log(`\n${title}`)
  console.table(rows)
}

async function request(method: string, path: string, body?: Json, token?: string) {
  const label = `${method} ${path}`
  if (body) console.log(`→ ${label} body=${JSON.stringify(body)}`)
  else console.log(`→ ${label}`)
  const res = await fetch(`${baseUrl}${path}`, {
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
    throw new Error(`HTTP ${res.status} ${res.statusText} ${method} ${path} -> ${text}`)
  }
  // Response bodies can be large/noisy; only log status above.
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

async function main() {
  assert(email && password, 'Set API_EMAIL and API_PASSWORD')

  baseUrl = await detectBaseUrl()
  console.log(`Base URL: ${baseUrl}`)

  console.log('Logging in...')
  const auth = await request('POST', '/auth/login', { email, password })
  const token = auth?.accessToken
  assert(token, 'Login failed: missing accessToken')

  console.log('Fetching communities...')
  const communities = await request('GET', '/communities', undefined, token)
  const community = (communities || []).find((c: any) => c.code === communityCode || c.id === communityCode)
  assert(community, `Community not found: ${communityCode}`)
  const communityId = community.id
  console.log(`Community: ${communityId}`)

  console.log('Fetching periods...')
  const allPeriods = await request('GET', `/communities/${communityId}/periods`, undefined, token)
  assert(Array.isArray(allPeriods) && allPeriods.length, 'No periods found')
  const period = [...allPeriods].sort((a: any, b: any) => (b.seq ?? 0) - (a.seq ?? 0))[0]
  const periodCode = period?.code
  assert(periodCode, 'Period code missing')
  console.log(`Using period: ${periodCode} (status=${period?.status ?? 'n/a'})`)

  console.log('Fetching cash accounts...')
  const accounts = await request('GET', `/communities/${communityId}/cash-accounts`, undefined, token)
  assert(Array.isArray(accounts) && accounts.length, 'No cash accounts found')
  const accountId = accounts[0].id
  console.log(`Cash account: ${accounts[0].code} (${accountId})`)

  console.log('Fetching cash tx (baseline)...')
  const cashTxBefore = await request('GET', `/communities/${communityId}/cash-tx`, undefined, token)
  assert(Array.isArray(cashTxBefore), 'Cash tx list invalid (baseline)')

  console.log('Fetching billing entities...')
  const besResp = await request('GET', `/communities/${communityId}/periods/${periodCode}/billing-entities`, undefined, token)
  const bes = Array.isArray(besResp) ? besResp : besResp?.items
  assert(Array.isArray(bes) && bes.length, 'No billing entities found')
  const be = bes[0]
  assert(be.id && be.code, 'Billing entity missing id/code')
  console.log(`Billing entity: ${be.code} (${be.id})`)

  const verifyPaymentInFinancials = async (
    paymentId: string,
    paymentTotal: number,
    appliedTotal: number,
    label: string,
  ) => {
    const fin = await request('GET', `/communities/be/${be.id}/periods/${periodCode}/financials`, undefined, token)
    const ledgerEntries = Array.isArray(fin?.ledgerEntries) ? fin.ledgerEntries : []
    const entry = ledgerEntries.find((e: any) => e.refType === 'PAYMENT' && e.refId === paymentId)
    assert(entry, `${label}: missing be_ledger entry`)
    const details = Array.isArray(entry?.details) ? entry.details : []
    const detailsTotal = details.reduce((sum: number, d: any) => sum + Number(d?.amount || 0), 0)
    assert(Math.abs(detailsTotal - paymentTotal) < 0.02, `${label}: be_ledger_details total mismatch`)
    assert(appliedTotal <= paymentTotal + 0.01, `${label}: applied total exceeds payment total`)
    console.log(`✔ ${label} reflected in be_ledger (details=${details.length}, total=${detailsTotal})`)
    printTable(`${label} be_ledger entry`, [
      {
        id: entry.id,
        periodId: entry.periodId,
        fundId: entry.fundId,
        amount: entry.amount,
        currency: entry.currency,
        refType: entry.refType,
        refId: entry.refId,
      },
    ])
    if (details.length) {
      printTable(`${label} be_ledger_details`, details.map((d: any) => ({
        unitCode: d?.unit?.code,
        amount: d.amount,
        fundId: d.fundId,
        refType: d.refType,
        refId: d.refId,
      })))
    }
    if (fin?.statement) {
      console.log(`ℹ be_statement: charges=${fin.statement.charges}, payments=${fin.statement.payments}, dueEnd=${fin.statement.dueEnd}`)
      printTable(`${label} be_statement`, [
        {
          charges: fin.statement.charges,
          payments: fin.statement.payments,
          adjustments: fin.statement.adjustments,
          dueStart: fin.statement.dueStart,
          dueEnd: fin.statement.dueEnd,
          currency: fin.statement.currency,
        },
      ])
    }
  }

  console.log('Paying based on be_ledger_details (SPEC from financials)...')
  const preFin = await request('GET', `/communities/be/${be.id}/periods/${periodCode}/financials`, undefined, token)
  const preStatement = preFin?.statement
  printTable('Pre-payment be_statement', [
    {
      charges: preStatement?.charges ?? null,
      payments: preStatement?.payments ?? null,
      adjustments: preStatement?.adjustments ?? null,
      dueStart: preStatement?.dueStart ?? null,
      dueEnd: preStatement?.dueEnd ?? null,
      currency: preStatement?.currency ?? null,
    },
  ])
  const ledgerEntries = Array.isArray(preFin?.ledgerEntries) ? preFin.ledgerEntries : []
  const details = ledgerEntries.flatMap((le: any) =>
    (Array.isArray(le?.details) ? le.details : []).map((d: any) => ({
      unitId: d?.unitId ?? d?.unit?.id ?? null,
      unitCode: d?.unit?.code ?? null,
      fundId: d?.fundId ?? le?.fundId ?? null,
      amount: Number(d?.amount ?? 0),
      currency: d?.currency ?? le?.currency ?? 'RON',
    })),
  ).filter((d: any) => d.unitId && Number.isFinite(d.amount) && d.amount > 0)
  if (details.length < 2) {
    console.log('Not enough be_ledger_details to build SPEC payment; skipping SPEC test')
  } else {
    const pick = () => details[Math.floor(Math.random() * details.length)]
    let a = pick()
    let b = pick()
    let guard = 0
    while ((a.unitId === b.unitId && a.fundId === b.fundId) && guard < 5) {
      b = pick()
      guard += 1
    }
    const aAmount = Number(a.amount)
    const bAmount = Math.max(0.01, Number(b.amount) / 2)
    const payAmount = Number(aAmount + bAmount)
    printTable('Selected be_ledger_details for SPEC', [
      { unitId: a.unitId, unitCode: a.unitCode, fundId: a.fundId, amount: aAmount, currency: a.currency, partial: false },
      { unitId: b.unitId, unitCode: b.unitCode, fundId: b.fundId, amount: bAmount, currency: b.currency, partial: true },
    ])

    const pay = await request(
      'POST',
      `/communities/${communityId}/payments`,
      {
        billingEntityId: be.id,
        amount: payAmount,
        currency: a.currency || 'RON',
        method: 'CASH',
        accountId,
        allocationSpec: [
          { amount: aAmount, unitId: a.unitId, fundId: a.fundId ?? undefined, billingEntityId: be.id },
          { amount: bAmount, unitId: b.unitId, fundId: b.fundId ?? undefined, billingEntityId: be.id },
        ],
      },
      token,
    )
    const expPayId = pay?.id ?? pay?.payment?.id
    assert(expPayId, 'Payment creation failed')
    console.log(`✔ Payment created (${expPayId}, amount=${payAmount})`)
    printTable('Payment created (SPEC)', [
      { id: expPayId, amount: payAmount, currency: a.currency || 'RON' },
    ])
    const expPayDetail = await request('GET', `/communities/${communityId}/payments/${expPayId}`, undefined, token)
    const apps = Array.isArray(expPayDetail?.applications) ? expPayDetail.applications : []
    assert(apps.length > 0, 'Payment did not create any applications')
    const matched = apps.some((app: any) => app?.spec?.source === 'SPEC')
    assert(matched, 'Payment did not apply using SPEC')
    const appsTotal = apps.reduce((sum: number, app: any) => sum + Number(app?.amount || 0), 0)
    assert(appsTotal <= payAmount + 0.01, 'Payment applications exceed payment amount')
    console.log(`✔ Payment applications verified (apps=${apps.length}, total=${appsTotal})`)
    printTable('Payment applications (SPEC)', apps.map((app: any) => ({
      amount: app.amount,
      chargeId: app.chargeId,
      unitId: app?.spec?.unitId,
      fundId: app?.spec?.fundId,
      source: app?.spec?.source,
    })))
    const paymentsListForSpec = await request('GET', `/communities/${communityId}/payments`, undefined, token)
    const listedSpec = Array.isArray(paymentsListForSpec)
      ? paymentsListForSpec.find((p: any) => p.id === expPayId)
      : null
    if (listedSpec) {
      const applied = Number(listedSpec.applied ?? 0)
      const remaining = Number(listedSpec.remaining ?? 0)
      assert(String(applied) === String(appsTotal), 'Applied amount does not match applications total')
      assert(Math.abs(applied + remaining - payAmount) < 0.02, 'Applied+remaining does not match payment amount')
      printTable('Payment applied/remaining (SPEC)', [
        { applied, remaining, amount: payAmount },
      ])
    }
    await verifyPaymentInFinancials(expPayId, payAmount, appsTotal, 'Payment')
  }

  console.log('Creating BE payment...')
  const bePayAmount = 10
  const payment = await request(
    'POST',
    `/communities/${communityId}/payments`,
    { billingEntityId: be.id, amount: bePayAmount, currency: 'RON', method: 'CASH', accountId },
    token,
  )
  const paymentId = payment?.id ?? payment?.payment?.id
  assert(paymentId, 'Payment creation failed')
  console.log(`BE payment: ${paymentId} (amount=${bePayAmount})`)
  printTable('BE payment created', [
    { id: paymentId, amount: bePayAmount, currency: 'RON', accountId },
  ])

  console.log('Verifying BE payment details...')
  const paymentDetail = await request('GET', `/communities/${communityId}/payments/${paymentId}`, undefined, token)
  assert(paymentDetail?.id === paymentId, 'Payment detail id mismatch')
  assert(String(paymentDetail?.amount) === String(bePayAmount), 'Payment amount mismatch')
  assert(paymentDetail?.status === 'POSTED', 'Payment status not POSTED')
  console.log(`✔ BE payment detail verified (amount=${paymentDetail?.amount}, status=${paymentDetail?.status})`)
  printTable('BE payment detail', [
    {
      id: paymentDetail.id,
      amount: paymentDetail.amount,
      status: paymentDetail.status,
      method: paymentDetail.method,
      ts: paymentDetail.ts,
    },
  ])
  await verifyPaymentInFinancials(paymentId, bePayAmount, bePayAmount, 'BE payment')

  console.log('Verifying payments list reflects new payment...')
  const paymentsList = await request('GET', `/communities/${communityId}/payments`, undefined, token)
  const listed = Array.isArray(paymentsList) ? paymentsList.find((p: any) => p.id === paymentId) : null
  assert(listed, 'Payment not found in list')
  assert(String(listed.amount) === String(bePayAmount), 'Listed payment amount mismatch')
  if (listed?.accountId != null) {
    assert(listed.accountId === accountId, 'Listed payment accountId mismatch')
  } else {
    console.log('Payment list does not include accountId; skipping accountId check')
  }
  console.log('✔ BE payment listed (count verified)')
  printTable('Payments list (match)', [
    {
      id: listed?.id,
      amount: listed?.amount,
      accountId: listed?.accountId ?? null,
      applied: listed?.applied ?? null,
      remaining: listed?.remaining ?? null,
    },
  ])

  console.log('Fetching invoices (optional vendor payment test)...')
  const invoices = await request('GET', `/communities/${communityId}/invoices`, undefined, token)
  const invoice = (invoices || [])[0]
  if (invoice?.id) {
    console.log(`Creating vendor payment for invoice ${invoice.id}...`)
    const vendorPayAmount = Number(invoice.gross || 10)
    const vendorPayment = await request(
      'POST',
      `/communities/${communityId}/invoices/${invoice.id}/payments`,
      { amount: vendorPayAmount, accountId },
      token,
    )
    assert(vendorPayment?.payment?.id || vendorPayment?.id, 'Vendor payment creation failed')
    const vendorPaymentId = vendorPayment?.payment?.id || vendorPayment?.id
    console.log(`Vendor payment: ${vendorPaymentId} (amount=${vendorPayAmount})`)
    ;(global as any).__vendorPaymentId = vendorPaymentId
    ;(global as any).__vendorPayAmount = vendorPayAmount
    console.log('✔ Vendor payment created')
    printTable('Vendor payment created', [
      { id: vendorPaymentId, amount: vendorPayAmount, accountId },
    ])
  } else {
    console.log('No invoices found; skipping vendor payment test')
  }

  console.log('Fetching cash tx (post actions)...')
  const tx = await request('GET', `/communities/${communityId}/cash-tx`, undefined, token)
  assert(Array.isArray(tx), 'Cash tx list invalid')
  const hasBeTx = tx.some((t: any) => t.refType === 'BE_PAYMENT' && t.refId === paymentId)
  const vendorPaymentId = (global as any).__vendorPaymentId as string | undefined
  const vendorPayAmount = (global as any).__vendorPayAmount as number | undefined
  const hasVendorTx = vendorPaymentId
    ? tx.some((t: any) => t.refType === 'VENDOR_PAYMENT' && t.refId === vendorPaymentId)
    : tx.some((t: any) => t.refType === 'VENDOR_PAYMENT')
  assert(hasBeTx, 'Missing BE_PAYMENT cash tx')
  if (invoice?.id) assert(hasVendorTx, 'Missing VENDOR_PAYMENT cash tx')
  console.log(`✔ Cash tx entries found for payments (total=${tx.length}, baseline=${cashTxBefore.length})`)

  const beCashTx = tx.find((t: any) => t.refType === 'BE_PAYMENT' && t.refId === paymentId)
  assert(beCashTx?.direction === 'IN', 'BE payment cash tx direction mismatch')
  assert(String(beCashTx?.amount) === String(bePayAmount), 'BE payment cash tx amount mismatch')
  console.log(`✔ BE cash tx verified (amount=${beCashTx?.amount}, direction=${beCashTx?.direction})`)
  printTable('Cash tx (BE payment)', [
    { id: beCashTx?.id, amount: beCashTx?.amount, direction: beCashTx?.direction, refId: beCashTx?.refId },
  ])

  if (vendorPaymentId) {
    const vtx = tx.find((t: any) => t.refType === 'VENDOR_PAYMENT' && t.refId === vendorPaymentId)
    assert(vtx?.direction === 'OUT', 'Vendor payment cash tx direction mismatch')
    if (vendorPayAmount != null) {
      assert(String(vtx?.amount) === String(vendorPayAmount), 'Vendor payment cash tx amount mismatch')
    }
    console.log(`✔ Vendor cash tx verified (amount=${vtx?.amount}, direction=${vtx?.direction})`)
    printTable('Cash tx (vendor payment)', [
      { id: vtx?.id, amount: vtx?.amount, direction: vtx?.direction, refId: vtx?.refId },
    ])
  }

  console.log('Verifying cash tx count increased...')
  assert(tx.length >= cashTxBefore.length + 1, 'Cash tx count did not increase as expected')
  console.log(`✔ Cash tx count increased (baseline=${cashTxBefore.length}, now=${tx.length})`)
  console.log('✅ API smoke test passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
