// Builds the public vicusia.ro website: wraps pages/*.html in one layout and copies static/*
// into dist/. No dependencies. Run: node site/build.mjs
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the form sends requests. Empty = the form says plainly that it isn't connected yet.
const CONTACT_EMAIL = ''
const ORIGIN = 'https://vicusia.ro'
const LOGIN_URL = '/app'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, 'dist')
const layout = readFileSync(join(root, 'layout.html'), 'utf8')
const fill = (text, vars) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(join(root, 'static'), dist, { recursive: true })

const indexed = []
for (const file of readdirSync(join(root, 'pages')).filter((f) => f.endsWith('.html'))) {
  const source = readFileSync(join(root, 'pages', file), 'utf8')
  const header = source.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\n/)
  if (!header) throw new Error(`${file}: missing JSON header comment`)
  const page = JSON.parse(header[1])
  const vars = { ...page, ORIGIN, LOGIN_URL, CONTACT_EMAIL, YEAR: String(new Date().getFullYear()) }
  vars.robots = page.noindex ? 'noindex' : 'index, follow'
  vars.content = fill(source.slice(header[0].length), vars)
  const out = join(dist, page.path, 'index.html')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, fill(layout, vars))
  if (!page.noindex) indexed.push(page.path)
}

const urls = indexed.sort().map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join('\n')
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
)
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nDisallow: /app\nDisallow: /api/\nSitemap: ${ORIGIN}/sitemap.xml\n`)
console.log(`site: ${indexed.length} indexed pages -> ${dist}`)
