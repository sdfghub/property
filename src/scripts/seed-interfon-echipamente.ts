// "Interfon - Echipamente" on the întreținere list: a fixed amount per unit (data/Kralik/interfon-echipamente.json,
// column N of the "Internfon - Posturi" sheet) = the price of the chosen interior post over the default one
// + access cards (+ keys). Idempotent.
//   npm run seed:interfon-echipamente -- Kralik 2026-09
// 1. Expense type INTERFON_ECHIPAMENTE (fund EXPENSES, no split template — amounts are explicit per unit).
// 2. Avizier order: the code goes right after INTERFON in every serviceConfig domain that lists INTERFON.
// 3. A MANUAL charge in the period through AllocationService.createExpense (method FIXED, precomputed
//    per-unit amounts, each line carrying its explanation: post, difference, cards). MANUAL charges are
//    not re-derived by prepare, so the amounts stay as given. Re-prepare the period afterwards.
import fs from 'fs'
import path from 'path'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { AllocationService } from '../modules/billing/allocation.service'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const CODE = 'INTERFON_ECHIPAMENTE'
const NAME = 'Interfon - Echipamente'
const lei = (n: number) => n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const [comm, periodCode] = process.argv.slice(2)
  if (!comm || !periodCode) throw new Error('usage: seed:interfon-echipamente -- <COMMUNITY> <YYYY-MM>')
  const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', comm, 'interfon-echipamente.json'), 'utf8'))
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService)
  const alloc = app.get(AllocationService)
  try {
    const community = await prisma.community.findFirst({ where: { OR: [{ id: comm }, { code: comm }] } })
    if (!community) throw new Error(`community ${comm} not found`)
    const period = await prisma.period.findUnique({ where: { communityId_code: { communityId: community.id, code: periodCode } } })
    if (!period) throw new Error(`period ${periodCode} not found`)
    if (period.status === 'CLOSED') throw new Error(`period ${periodCode} is CLOSED`)

    // 1. expense type, on the same rule as INTERFON
    const interfon = await prisma.expenseType.findFirst({ where: { communityId: community.id, code: 'INTERFON' } })
    if (!interfon) throw new Error('expense type INTERFON not found')
    await prisma.expenseType.upsert({
      where: { code_communityId: { code: CODE, communityId: community.id } },
      create: { communityId: community.id, code: CODE, name: NAME, ruleId: interfon.ruleId, params: { fundCode: 'EXPENSES' } },
      update: { name: NAME, params: { fundCode: 'EXPENSES' } },
    })

    // 2. avizier column order: right after INTERFON
    const features: any = community.features ?? {}
    const domains: any[] = features.associationInfo?.serviceConfig?.domains ?? []
    let touched = false
    for (const d of domains) {
      const codes: string[] = Array.isArray(d.serviceCodes) ? d.serviceCodes : []
      const i = codes.indexOf('INTERFON')
      if (i >= 0 && !codes.includes(CODE)) { codes.splice(i + 1, 0, CODE); d.serviceCodes = codes; touched = true }
    }
    if (touched) await prisma.community.update({ where: { id: community.id }, data: { features } })

    // 3. the charge, one explained line per unit
    const units = await prisma.unit.findMany({ where: { communityId: community.id }, select: { code: true } })
    const codeOf = (label: string) => units.find((u) => u.code.split('-').slice(3).join('-') === label)?.code
    const perUnit = (data.units as any[]).filter((u) => u.amount > 0).map((u) => {
      const code = codeOf(u.unit)
      if (!code) throw new Error(`unit ${u.unit} not found`)
      const parts: string[] = []
      if (u.post) {
        parts.push(u.postExtra > 0
          ? `Post interior ${u.post}: ${lei(u.postBase + u.postExtra)} lei, diferență față de postul de bază ${data.defaultPost} (${lei(u.postBase)} lei, nu intră pe listă) ${lei(u.postExtra)} lei`
          : `Post interior ${u.post} (postul de bază, ${lei(u.postBase)} lei, nu intră pe listă, fără diferență)`)
      }
      if (u.cards > 0) parts.push(`${u.cards} ${u.cards === 1 ? 'cartelă' : 'cartele'} × ${lei(data.cardPrice)} lei`)
      if (u.keysCost > 0) parts.push(`chei ${lei(u.keysCost)} lei`)
      return { unitCode: code, amount: u.amount, detail: parts.join(' + ') }
    })
    const total = Math.round(perUnit.reduce((s, u) => s + u.amount, 0) * 100) / 100
    await alloc.createExpense(community.id, { id: period.id, seq: period.seq, code: period.code } as any, {
      description: NAME,
      amount: total,
      expenseTypeCode: CODE,
      sourceType: 'MANUAL' as any,
      sourceId: `${CODE}:${periodCode}`,
      sourceKey: CODE.toLowerCase(),
      allocationMethod: 'FIXED',
      allocationParams: { perUnit },
    })
    console.log(`✅ ${NAME} ${periodCode}: ${perUnit.length} units, ${lei(total)} lei${touched ? '; avizier order updated' : ''}`)
  } finally {
    await app.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
