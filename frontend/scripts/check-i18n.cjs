#!/usr/bin/env node
/**
 * i18n gate: every key used through t() must exist in BOTH `en` and `ro` in src/i18n/lang.ts,
 * and the two maps must stay at parity. Exits 1 with a report when they don't.
 *
 *   cd frontend && npm run check:i18n
 *
 * Matches all three call forms in use, which is the whole point — an earlier pass that only
 * understood t('key', 'fallback') silently missed 8 raw keys that shipped to the UI:
 *   t('key')                     t('key', 'fallback')                 t('key') || 'fallback'
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(process.cwd(), 'src')
if (!fs.existsSync(SRC)) {
  console.error('✖ run this from the frontend/ directory (no ./src here)')
  process.exit(1)
}

const files = []
;(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !p.endsWith('lang.ts')) files.push(p)
  }
})(SRC)

const usedKeys = new Set()
const usedIn = new Map() // key -> first file that uses it
const keyRe = /\b(?:t|tr|rawT)\(\s*(['"])([\w.]+)\1/g
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  let m
  while ((m = keyRe.exec(s))) {
    usedKeys.add(m[2])
    if (!usedIn.has(m[2])) usedIn.set(m[2], path.relative(process.cwd(), f))
  }
}

// lang.ts is `{ en: { 'key': 'value', ... }, ro: { ... } }` — read the two blocks by line.
const lang = fs.readFileSync(path.join(SRC, 'i18n', 'lang.ts'), 'utf8').split('\n')
const enStart = lang.findIndex((l) => /^\s*en:\s*\{/.test(l))
const roStart = lang.findIndex((l) => /^\s*ro:\s*\{/.test(l))
if (enStart < 0 || roStart < 0) {
  console.error('✖ could not locate the `en:` / `ro:` blocks in src/i18n/lang.ts')
  process.exit(1)
}
const keyLine = /^\s*(['"])([\w.]+)\1\s*:/
const en = new Set()
const ro = new Set()
for (let i = enStart + 1; i < roStart; i++) { const mm = lang[i].match(keyLine); if (mm) en.add(mm[2]) }
for (let i = roStart + 1; i < lang.length; i++) { const mm = lang[i].match(keyLine); if (mm) ro.add(mm[2]) }

const missing = [...usedKeys].filter((k) => !en.has(k) || !ro.has(k)).sort()
const enOnly = [...en].filter((k) => !ro.has(k)).sort()
const roOnly = [...ro].filter((k) => !en.has(k)).sort()

console.log(`i18n: ${usedKeys.size} keys used in ${files.length} files | en ${en.size} · ro ${ro.size}`)

if (missing.length) {
  console.error(`\n✖ ${missing.length} used key(s) missing from en and/or ro — the raw key renders in the UI:`)
  for (const k of missing) {
    const where = []
    if (!en.has(k)) where.push('en')
    if (!ro.has(k)) where.push('ro')
    console.error(`   ${k}  (missing: ${where.join('+')})  first used in ${usedIn.get(k)}`)
  }
}
if (enOnly.length || roOnly.length) {
  console.error(`\n✖ en/ro parity broken: ${enOnly.length} en-only, ${roOnly.length} ro-only`)
  if (enOnly.length) console.error(`   en-only: ${enOnly.slice(0, 20).join(', ')}${enOnly.length > 20 ? ' …' : ''}`)
  if (roOnly.length) console.error(`   ro-only: ${roOnly.slice(0, 20).join(', ')}${roOnly.length > 20 ? ' …' : ''}`)
}

if (missing.length || enOnly.length || roOnly.length) {
  console.error('\nAdd the key to BOTH maps in src/i18n/lang.ts (see docs/frontend-conventions.md).')
  process.exit(1)
}
console.log('✓ all used keys present in both languages, en/ro at parity')
