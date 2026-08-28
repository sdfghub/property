// Seeds Kralik's "Informații Asociație" (legal identity, bank accounts, AGA/CEX, administrator)
// under Community.features.associationInfo. Run once to populate the new page; safe to re-run
// (idempotent full replace of just the associationInfo key — every other features.* key survives).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const COMM = 'Kralik'

async function main() {
  const community = await prisma.community.findUniqueOrThrow({ where: { id: COMM }, select: { id: true, features: true } })
  const features = ((community.features as any) || {})

  const associationInfo = {
    address: 'Strada Gheorghe Lazăr nr. 4, Timișoara',
    legalName: 'Asociația De Proprietari Gheorghe Lazăr Nr. 4',
    statutStatus: 'Activ',
    foundingDate: '2015-09-01',
    actConstitutivNr: 'AC-2015-1234',
    acordAsociereNr: 'AA-2015-1234',
    acordAsociereDate: '2015-09-05',
    cif: '13858899',
    bankAccounts: [
      { bank: 'Libra', currency: 'RON', iban: 'RO31BREL0002002274380100' },
      { bank: 'Libra', currency: 'EUR', iban: 'RO20BREL0002002274380201' },
    ],
    legalRep: { name: 'Mihai Colcea', title: 'Președinte', phone: '+40 723 456 789', email: 'asociatie@lazar4.ro' },
    aga: { lastMeeting: '2026-04-21', nextMeeting: '2026-02-20' },
    boardMembers: [
      { name: 'Mihai Colcea', role: 'Președinte' },
      { name: 'Mihnea Radu', role: 'Vice-Președinte' },
      { name: 'Ruxandra-Georgeta Codrea', role: 'Cenzor' },
      { name: 'Ana-Maria Rădoi', role: 'Membru' },
      { name: 'Marius David', role: 'Membru' },
    ],
    administrator: {
      company: 'SC RUSADMINISTRA COMPANY SRL',
      rep: 'Claudia Ciobanu',
      hours: 'Luni-Vineri, între orele 08:00 - 17:30',
      phone: '0769871073',
      email: 'claudia_ciobanu2007@yahoo.com',
      address: 'Str. Vasile Alecsandri Nr. 4, Ap 9. Interfon: 09.',
    },
    roiPolicy: {
      description: 'Regulamentul de Ordine Interioară stabilește regulile de conviețuire, obligațiile financiare și procedurile aplicabile în cadrul asociației.',
      tiers: [
        { key: 'none', label: 'Fără risc', tone: 'positive', rangeLabel: '≤ 30 zile', actionTitle: 'Nicio acțiune', actionDesc: 'Situație în termen legal, nu se aplică măsuri.' },
        { key: 'low', label: 'Risc scăzut', tone: 'warning', rangeLabel: '30–60 zile', actionTitle: 'Penalități', actionDesc: 'Se aplică penalități de întârziere conform hotărârii AGA.' },
        { key: 'medium', label: 'Risc mediu', tone: 'orange', rangeLabel: '60–120 zile', actionTitle: 'Înscriere sarcină în CF', actionDesc: 'Se înscrie sarcina în Cartea Funciară a proprietății debitoare.' },
        { key: 'high', label: 'Risc ridicat', tone: 'negative', rangeLabel: '≥ 120 zile', actionTitle: 'Acțiune în instanță', actionDesc: 'Se demarează procedura judiciară de recuperare a creanței.' },
      ],
    },
    // Services are keyed by the real ExpenseType.code (from GET .../finance/expense-catalog), never
    // by stored labels, in the exact order avizier() uses for its expense-type columns — see
    // AssociationInfoPanel.tsx and finance.service.ts's serviceOrderIndex().
    serviceConfig: {
      domains: [
        { key: 'apa', name: 'Apă', serviceCodes: ['APA_RECE', 'CANALIZARE', 'PENALITATI_APA', 'APA_METEO'] },
        { key: 'iluminat', name: 'Iluminat', serviceCodes: ['CURENT_SCARA'] },
        { key: 'igiena', name: 'Igienă & Îngrijire', serviceCodes: ['SALUBRITATE', 'CURATENIE'] },
        { key: 'securitate', name: 'Securitate & Acces', serviceCodes: ['INTERFON'] },
        { key: 'administrativ', name: 'Administrativ', serviceCodes: ['ADMINISTRARE', 'COMISION_BANCA'] },
      ],
    },
  }

  await prisma.community.update({ where: { id: community.id }, data: { features: { ...features, associationInfo } } })
  console.log(`associationInfo seeded for ${COMM}`)
}

main().finally(() => prisma.$disconnect())
