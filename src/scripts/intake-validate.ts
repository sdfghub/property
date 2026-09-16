/**
 * Validate an agent's `intake-import/v1` JSON against the contract AND the community's live catalogue,
 * printing per-record blockers — without writing anything. This is how a prompt/agent iteration gets
 * checked before an admin imports the file.
 *
 * Usage:
 *   npm run intake:validate -- <file.json> [CommunityCode=Kralik] [--period 2026-07] [--json]
 *   npm run intake:validate -- --prompt Kralik 2026-07 > prompt.md     # print the prompt pack instead
 *
 * Exit code 1 on contract errors or when any record carries a hard (non-overridable) blocker.
 */
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import * as fs from 'fs'
import { FeaturesModule } from '../modules/features/features.module'
import { IntakeModule } from '../modules/intake/intake.module'
import { IntakeImportService } from '../modules/intake/intake-import.service'
import { IntakePromptService } from '../modules/intake/intake-prompt.service'

@Module({ imports: [FeaturesModule, IntakeModule] })
class ScriptModule {}

async function main() {
  const args = process.argv.slice(2)
  const flag = (name: string) => {
    const i = args.indexOf(name)
    if (i < 0) return undefined
    const v = args[i + 1]
    args.splice(i, 2)
    return v
  }
  const asJson = args.includes('--json')
  if (asJson) args.splice(args.indexOf('--json'), 1)
  const promptMode = args.includes('--prompt')
  if (promptMode) args.splice(args.indexOf('--prompt'), 1)
  const period = flag('--period')

  const app = await NestFactory.createApplicationContext(ScriptModule, { logger: ['error'] })
  try {
    if (promptMode) {
      const [community = 'Kralik', periodCode = period] = args
      if (!periodCode) throw new Error('--prompt needs a period: --prompt <Community> <YYYY-MM>')
      const pack = await app.get(IntakePromptService).buildPack(community, periodCode)
      process.stdout.write(pack.prompt)
      return
    }
    const [file, community = 'Kralik'] = args
    if (!file) throw new Error('usage: intake-validate <file.json> [Community] [--period YYYY-MM]')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    const importer = app.get(IntakeImportService)
    let result
    try {
      result = await importer.checkPayload(community, raw, { expectedPeriodCode: period })
    } catch (e: any) {
      const r = e?.response ?? e
      console.error(`✖ ${r?.message ?? e?.message ?? e}`)
      for (const i of r?.issues ?? []) console.error(`   ${i.index != null ? `records[${i.index}] ` : ''}${i.path}: ${i.message}`)
      process.exitCode = 1
      return
    }
    const { payload, records, catalogue } = result
    if (asJson) {
      console.log(JSON.stringify({ periodCode: payload.periodCode, community: catalogue.community.code, records }, null, 2))
    } else {
      console.log(`intake-validate: ${catalogue.community.code} / ${payload.periodCode} (${catalogue.period.status}) — ${records.length} record(s), agent=${payload.meta.agent ?? '?'}, prompt=${payload.promptVersion ?? '?'}`)
      for (const r of records) {
        const inv = r.kind === 'INVOICE' ? r.extracted : null
        const head = inv ? `${inv.vendorName ?? '?'} · ${inv.number ?? '?'} · ${inv.gross ?? '?'} ${inv.currency ?? ''}` : r.kind === 'BANK_LINE' ? `${r.extracted?.date ?? '?'} · ${r.extracted?.amount ?? '?'} · ${r.extracted?.counterpartyName ?? ''}` : r.extracted?.note ?? ''
        const alloc = inv ? Object.entries(r.resolved?.byTemplate ?? {}).map(([t, items]: any) => `${t}: ${Object.entries(items).map(([k, v]) => `${k} ${v}`).join(', ')}`).join(' | ') : ''
        console.log(`\n#${r.index} [${r.kind}] ${r.status}  conf=${r.confidence ?? '?'}  ${r.sourceFile ?? ''}`)
        console.log(`   ${head}`)
        if (alloc) console.log(`   → ${alloc}`)
        for (const b of r.blockers) console.log(`   ${b.overridable ? '⚠' : '✖'} ${b.code}${b.path ? ` @ ${b.path}` : ''}: ${b.message}`)
      }
      const hard = records.filter((r) => r.blockers.some((b) => !b.overridable)).length
      const soft = records.filter((r) => r.blockers.length && !r.blockers.some((b) => !b.overridable)).length
      console.log(`\n${records.length - hard - soft} clean · ${soft} with warnings · ${hard} with hard blockers`)
      if (hard) process.exitCode = 1
    }
  } finally {
    await app.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
