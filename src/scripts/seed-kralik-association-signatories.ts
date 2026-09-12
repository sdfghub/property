// Populate Community.features.associationInfo.boardMembers + administrator for Kralik.
// The avizier's signature block (Președinte/Cenzor/Administrator) reads these via
// GET /communities/:id/association-info — they were never set, so all three signatures showed
// blank ("—"). Names sourced from the association's own official monthly table, which every
// "Lista de plată" PDF already prints in its footer (RUSADMINISTRA COMPANY / Ruxandra Codrea
// Georgeta / Colcea Mihai).
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { BillingModule } from '../modules/billing/billing.module'
import { PeriodModule } from '../modules/period/period.module'
import { FeaturesModule } from '../modules/features/features.module'
import { PrismaService } from '../modules/user/prisma.service'

@Module({ imports: [FeaturesModule, BillingModule, PeriodModule] })
class ScriptModule {}

const COMM = 'Kralik'

async function main() {
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  const prisma = app.get(PrismaService) as any

  const c = await prisma.community.findFirst({ where: { id: COMM }, select: { id: true, features: true } })
  if (!c) throw new Error('Kralik not found')
  const features = (c.features as any) || {}
  const info = features.associationInfo || {}

  const nextInfo = {
    ...info,
    boardMembers: [
      { name: 'Colcea Mihai', role: 'Președinte' },
      { name: 'Ruxandra Codrea Georgeta', role: 'Cenzor' },
    ],
    administrator: {
      ...(info.administrator || {}),
      company: 'RUSAdministra Company',
      rep: info.administrator?.rep ?? null,
    },
  }

  await prisma.community.update({ where: { id: c.id }, data: { features: { ...features, associationInfo: nextInfo } } })
  console.log('✅ associationInfo.boardMembers + administrator set for Kralik')
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
