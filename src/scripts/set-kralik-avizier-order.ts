// Set the explicit service and fund display order for Kralik's avizier, per Adriana Dascal's
// request: services Apa Rece, Apa Rece - Dif, Apa Meteo, Curent Scara, Salubritate, Curatenie,
// Administrare, Comision Banca (APA_DIF auto-inserts right after APA_RECE — see
// FinanceService.serviceOrderIndex()); funds Rulment, Reparatii, Reabilitare 1, 2, 3.
// Both mechanisms already exist in the app (Community.features.associationInfo.serviceConfig.domains
// for services, Community.features.avizierConfig.fundOrder for funds) — they were just empty for
// Kralik, which is why services/funds fell back to alphabetical order.
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

  const c = await prisma.community.findFirst({ where: { OR: [{ id: COMM }, { code: COMM }] }, select: { id: true, features: true } })
  if (!c) throw new Error('Community not found')
  const features = (c.features as any) || {}

  const associationInfo = features.associationInfo || {}
  const serviceConfig = associationInfo.serviceConfig || { domains: [] }
  const domains = Array.isArray(serviceConfig.domains) ? serviceConfig.domains.slice() : []
  const idx = domains.findIndex((d: any) => d.key === 'default')
  const defaultDomain = {
    key: 'default',
    name: 'Servicii',
    serviceCodes: ['APA_RECE', 'APA_METEO', 'CURENT_SCARA', 'SALUBRITATE', 'CURATENIE', 'ADMINISTRARE', 'COMISION_BANCA'],
  }
  if (idx >= 0) domains[idx] = { ...domains[idx], ...defaultDomain }
  else domains.push(defaultDomain)

  const avizierConfig = features.avizierConfig || {}
  const fundOrder = ['RULMENT', 'REPARATII', 'REABILITARE_1', 'REABILITARE_2', 'REABILITARE_3']

  const nextFeatures = {
    ...features,
    associationInfo: { ...associationInfo, serviceConfig: { ...serviceConfig, domains } },
    avizierConfig: { ...avizierConfig, fundOrder },
  }

  await prisma.community.update({ where: { id: c.id }, data: { features: nextFeatures } })
  console.log('✅ service order set:', defaultDomain.serviceCodes.join(', '))
  console.log('✅ fund order set:', fundOrder.join(', '))

  await app.close()
}
main().catch((e) => { console.error(e?.message || e); process.exit(1) })
