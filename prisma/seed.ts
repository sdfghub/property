import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt as scryptCallback } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(scryptCallback)
const prisma = new PrismaClient()

async function ensureRootUser() {
  const email = process.env.ROOT_EMAIL || 'bogdan.boji@gmail.com'
  const password = process.env.ROOT_PASSWORD || '123456'
  const passwordHash = await hashPassword(password)
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: 'Root Admin', passwordHash },
    create: { email, name: 'Root Admin', passwordHash },
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
  console.log(`[seed] Root user ensured: ${email}`)
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${derivedKey.toString('hex')}`
}

async function main() {
  await ensureRootUser()
  // Add your own communities/periods via import scripts or custom seed logic.
}
main().finally(()=>prisma.$disconnect())
