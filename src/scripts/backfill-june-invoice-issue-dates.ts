// Backfill real issue dates for Kralik's June 2026 vendor invoices, transcribed directly from the
// actual invoice PDFs (same source as backfill-june-invoice-due-dates.ts). Only issueDate touched.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ISSUE_DATES: Record<string, string> = {
  'TM 19690906': '2026-06-30',       // RETIM — "Data facturii: 30.06.2026"
  'RC 0107': '2026-08-03',           // RICH CLEAN — "Data 03.08.2026"
  '26EI 12312610': '2026-07-11',     // PPC — "din data de 11.07.2026"
  'TMA10/1015558474': '2026-07-06',  // Aquatim — "Data emiterii: 06.07.2026"
  'TM 1830': '2026-07-25',           // RUSADMINISTRA — "Data (zi/luna/an): 25/07/2026"
}

async function main() {
  for (const [number, issueDate] of Object.entries(ISSUE_DATES)) {
    const res = await prisma.vendorInvoice.updateMany({
      where: { communityId: 'Kralik', number },
      data: { issueDate: new Date(issueDate) },
    })
    console.log(`${number} -> ${issueDate}: ${res.count} row(s) updated`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
