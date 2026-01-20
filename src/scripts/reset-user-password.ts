import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

function normalizeEmail(email: string){ return email.trim().toLowerCase() }

async function hashPassword(password: string){
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt}$${derived.toString('hex')}`
}

function parseArg(flag: string){
  const idx = process.argv.indexOf(flag)
  if (idx === -1 || idx === process.argv.length - 1) return null
  return process.argv[idx + 1]
}

async function main(){
  const emailRaw = parseArg('--email')
  const password = parseArg('--password')
  if (!emailRaw || !password) {
    console.error('Usage: ts-node --transpile-only src/scripts/reset-user-password.ts --email user@example.com --password NEW_PASSWORD')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  const email = normalizeEmail(emailRaw)
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`User not found: ${email}`)
    await prisma.$disconnect()
    process.exit(1)
  }

  const passwordHash = await hashPassword(password)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
  await prisma.$disconnect()
  console.log(`Password updated for ${email} (id=${user.id})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
