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

  const files = fs.readdirSync(communityDir)
  const periodSet = new Set<string>()
  for (const f of files) {
    const m = f.match(/(meters)-(\d{4}-\d{2})/i)
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
  }

  console.log('✅ API reset/import complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
