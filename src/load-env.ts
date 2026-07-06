// Minimal .env loader (side-effect import) so `npm run dev` picks up local config
// (DATABASE_URL, PORT, ...) without a runtime dotenv dependency. Existing process.env
// values are NOT overridden, so command-line overrides still take precedence.
import fs from 'fs'
import path from 'path'

try {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      if (!key || process.env[key] !== undefined) continue
      let val = line.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      process.env[key] = val
    }
  }
} catch {
  // ignore — fall back to whatever is already in the environment
}
