import { PrismaClient, Role, ScopeType } from '@prisma/client'

const prisma = new PrismaClient()

function usage(msg?: string): never {
  if (msg) console.error(`Error: ${msg}\n`)
  console.log(`Make a user a SYSTEM_ADMIN.

Usage:
  npm run make:system-admin -- --email <email>
  npm run make:system-admin -- --user-id <id>
`)
  process.exit(msg ? 1 : 0)
}

function parseArgs(argv: string[]) {
  let email: string | null = null
  let userId: string | null = null
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--email') email = argv[++i]
    else if (a === '--user-id') userId = argv[++i]
    else usage(`Unknown arg: ${a}`)
  }
  if (!email && !userId) usage('Provide --email or --user-id')
  return { email, userId }
}

async function main() {
  const { email, userId } = parseArgs(process.argv)
  const user = await prisma.user.findFirst({
    where: email ? { email } : { id: userId ?? '' },
    select: { id: true, email: true, name: true },
  })
  if (!user) {
    throw new Error('User not found')
  }
  const existing = await prisma.roleAssignment.findFirst({
    where: {
      userId: user.id,
      role: Role.SYSTEM_ADMIN,
      scopeType: ScopeType.SYSTEM,
      scopeId: null,
    },
    select: { id: true },
  })
  if (!existing) {
    await prisma.roleAssignment.create({
      data: {
        userId: user.id,
        role: Role.SYSTEM_ADMIN,
        scopeType: ScopeType.SYSTEM,
        scopeId: null,
      },
    })
  }
  // eslint-disable-next-line no-console
  console.log(`✅ SYSTEM_ADMIN set for ${user.email ?? user.id}`)
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
