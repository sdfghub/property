import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Record a payment and apply it to open charges (idempotent via --ref).

Usage:
  npm run add:payment -- <communityId> <beCode> <amount> [--ref <id>] [--ts YYYY-MM-DD] [--method <str>]
`)
  process.exit(msg ? 1 : 0)
}

type Args = {
  communityId: string
  beCode: string
  amount: number
  ref?: string
  ts?: string
  method?: string
}

function parseArgs(argv: string[]): Args {
  const [communityId, beCode, amountStr, ...rest] = argv.slice(2)
  if (!communityId || !beCode || !amountStr) usage('Missing communityId, beCode or amount')
  const amount = Number(amountStr)
  if (!Number.isFinite(amount)) usage('Amount must be a number')
  let ref: string | undefined
  let ts: string | undefined
  let method: string | undefined
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--ref') ref = rest[++i]
    else if (rest[i] === '--ts') ts = rest[++i]
    else if (rest[i] === '--method') method = rest[++i]
    else usage(`Unknown arg: ${rest[i]}`)
  }
  return { communityId, beCode, amount, ref, ts, method }
}

async function main() {
  const args = parseArgs(process.argv)
  const be = await prisma.billingEntity.findUnique({
    where: { code_communityId: { code: args.beCode, communityId: args.communityId } },
    select: { id: true },
  })
  if (!be) usage(`Billing entity ${args.beCode} not found in ${args.communityId}`)

  const client: any = prisma as any
  let payment = args.ref ? await client.payment?.findUnique({ where: { refId: args.ref }, include: { applications: true } }) : null

  if (payment) {
    // Reset applications for idempotency
    await client.paymentApplication?.deleteMany({ where: { paymentId: payment.id } })
    payment = await client.payment.update({
      where: { id: payment.id },
      data: { amount: args.amount, ts: args.ts ? new Date(args.ts) : payment.ts, method: args.method ?? payment.method },
    })
  } else {
    payment = await client.payment.create({
      data: {
        communityId: args.communityId,
        billingEntityId: be.id,
        amount: args.amount,
        currency: 'RON',
        ts: args.ts ? new Date(args.ts) : undefined,
        method: args.method ?? null,
        refId: args.ref ?? null,
      },
    })
  }

  const rows: Array<{
    chargeId: string
    chargeCreatedAt: Date
    chargeBucket: string
    detailId: string
    unitId?: string | null
    detailAmount: number
    chargeApplied: number
  }> = await prisma.$queryRawUnsafe(
    `
    SELECT le.id AS "chargeId",
           le.created_at AS "chargeCreatedAt",
           le.bucket AS "chargeBucket",
           d.id AS "detailId",
           d.unit_id AS "unitId",
           d.amount::numeric AS "detailAmount",
           COALESCE(app.paid,0)::numeric AS "chargeApplied"
    FROM be_ledger_entry le
    JOIN be_ledger_entry_detail d ON d.ledger_entry_id = le.id
    LEFT JOIN (
      SELECT charge_id, SUM(amount) AS paid
      FROM payment_application
      GROUP BY charge_id
    ) app ON app.charge_id = le.id
    WHERE le.community_id = $1
      AND le.billing_entity_id = $2
      AND le.kind = 'CHARGE'
      AND (le.amount - COALESCE(app.paid,0)) > 0
    ORDER BY le.created_at ASC, d.id ASC
    `,
    args.communityId,
    be.id,
  )

  const byCharge = new Map<
    string,
    {
      chargeId: string
      chargeCreatedAt: Date
      chargeBucket: string
      chargeApplied: number
      details: Array<{ detailId: string; unitId?: string | null; detailAmount: number }>
    }
  >()
  for (const r of rows) {
    const existing = byCharge.get(r.chargeId)
    if (existing) {
      existing.details.push({
        detailId: r.detailId,
        unitId: r.unitId,
        detailAmount: Number(r.detailAmount),
      })
    } else {
      byCharge.set(r.chargeId, {
        chargeId: r.chargeId,
        chargeCreatedAt: r.chargeCreatedAt,
        chargeBucket: r.chargeBucket,
        chargeApplied: Number(r.chargeApplied),
        details: [
          {
            detailId: r.detailId,
            unitId: r.unitId,
            detailAmount: Number(r.detailAmount),
          },
        ],
      })
    }
  }
  const charges = Array.from(byCharge.values()).sort(
    (a, b) => a.chargeCreatedAt.getTime() - b.chargeCreatedAt.getTime(),
  )

  let remaining = args.amount
  const applications: Array<{ paymentId: string; chargeId: string; amount: number; spec: any }> = []
  for (const c of charges) {
    if (remaining <= 0) break
    let appliedToCharge = c.chargeApplied
    for (const d of c.details) {
      if (remaining <= 0) break
      const detailAmount = Number(d.detailAmount)
      const alreadyApplied = Math.min(detailAmount, appliedToCharge)
      const detailRemaining = Math.max(0, detailAmount - alreadyApplied)
      appliedToCharge = Math.max(0, appliedToCharge - detailAmount)
      if (detailRemaining <= 0) continue
      const apply = Math.min(remaining, detailRemaining)
      if (apply > 0) {
        applications.push({
          paymentId: payment.id,
          chargeId: c.chargeId,
          amount: apply,
          spec: {
            source: 'AUTO_DETAIL',
            paymentId: payment.id,
            chargeId: c.chargeId,
            detailId: d.detailId,
            unitId: d.unitId ?? null,
            bucket: c.chargeBucket ?? null,
            amount: apply,
          },
        })
        remaining -= apply
      }
    }
  }

  if (applications.length) {
    await client.paymentApplication?.createMany({ data: applications, skipDuplicates: true })
  }

  console.log(
    `✅ Payment ${payment.id} (${args.ref ?? 'no-ref'}) amount=${args.amount} applied=${args.amount - remaining} remaining=${remaining}`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
