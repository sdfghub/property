// Backfill real due dates for Kralik's June 2026 vendor invoices, transcribed directly from the
// actual invoice PDFs (Aquatim, RETIM, RICH CLEAN, PPC) at the user's request. No amounts or any
// other field touched — only VendorInvoice.dueDate, only for these 4 specific invoice numbers.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DUE_DATES: Record<string, string> = {
  'TM 19690906': '2026-07-15',       // RETIM (Salubritate) — "Data scadenta: 15.07.2026"
  'RC 0107': '2026-08-03',           // RICH CLEAN (Curatenie) — "Scadent la 03.08.2026"
  '26EI 12312610': '2026-07-27',     // PPC (Curent Scara) — "Data scadenta: 27.07.2026"
  'TMA10/1015558474': '2026-07-20',  // Aquatim (Apa Rece/Canalizare/Penalitati + Apa Meteo) — "Data scadentei: 20.07.2026"
}

async function main() {
  for (const [number, dueDate] of Object.entries(DUE_DATES)) {
    const res = await prisma.vendorInvoice.updateMany({
      where: { communityId: 'Kralik', number },
      data: { dueDate: new Date(dueDate) },
    })
    console.log(`${number} -> ${dueDate}: ${res.count} row(s) updated`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
