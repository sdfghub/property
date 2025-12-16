import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function ensureRootUser() {
  const email = process.env.ROOT_EMAIL || 'bogdan.boji@gmail.com'
  // Passwords are not used in auth (magic links only); value is informational.
  const passwordNote = process.env.ROOT_PASSWORD || '123456'
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: 'Root Admin' },
    create: { email, name: 'Root Admin' },
  })

  const existingRole = await prisma.roleAssignment.findFirst({
    where: { userId: user.id, role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM', scopeId: null },
  })
  if (!existingRole) {
    await prisma.roleAssignment.create({
      data: { userId: user.id, role: 'SYSTEM_ADMIN', scopeType: 'SYSTEM', scopeId: null },
    })
  }

  // eslint-disable-next-line no-console
  console.log(`[seed] Root user ensured: ${email} (password hint: ${passwordNote})`)
}

async function main() {
  await ensureRootUser()
  // Add your own communities/periods via import scripts or custom seed logic.
}
main().finally(()=>prisma.$disconnect())
