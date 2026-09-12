/** One-off: import an agent JSON file as an intake batch (writes intake tables only). Usage: ts-node intake-import-file.ts <file> <Community> <YYYY-MM> <createdBy> */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import * as fs from 'fs'
import { FeaturesModule } from '../modules/features/features.module'
import { IntakeModule } from '../modules/intake/intake.module'
import { IntakeImportService } from '../modules/intake/intake-import.service'
import { IntakeService } from '../modules/intake/intake.service'

@Module({ imports: [FeaturesModule, IntakeModule] })
class ScriptModule {}

async function main() {
  const [file, community, period, createdBy] = process.argv.slice(2)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  try {
    const batch = await app.get(IntakeImportService, { strict: false }).importPayload(community, raw, { createdBy: createdBy ?? 'intake-import-file', sourceFileName: file.split('/').pop() ?? null, expectedPeriodCode: period })
    const { batch: b, records } = await app.get(IntakeService, { strict: false }).getBatch(community, batch.id)
    console.log(JSON.stringify({ batchId: b.id, status: b.status, stats: b.stats, records: records.map((r: any) => ({ index: r.index, kind: r.kind, status: r.status, blockers: r.blockers.map((x: any) => x.code) })) }, null, 1))
  } finally {
    await app.close()
  }
}
main().catch((e) => { console.error(e?.response ?? e); process.exit(1) })
