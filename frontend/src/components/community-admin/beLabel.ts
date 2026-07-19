// Short apartment label from a full unit code: "400191-C1-U8-AP 3" → "AP 3".
// Labels can contain hyphens (e.g. "AP 5 (I-A)"), so drop the first 3 dash-segments and rejoin.
export const shortUnit = (code: string) => (code || '').split('-').slice(3).join('-') || code || ''

// Readable owner from a raw BE code ("BE_MATEI_VIOREL" → "Matei Viorel"); passes through real names.
export const prettyBe = (s?: string) =>
  !s ? '' : (/^BE_/.test(s)
    ? s.replace(/^BE_/, '').split('_').map((w) => (w ? w[0] + w.slice(1).toLowerCase() : w)).join(' ')
    : s)

// Resolved billing-entity label: admin displayName if set, else short apt(s) + owner name.
export function beLabel(row: { displayName?: string | null; units?: string[]; beName?: string; beCode?: string }): { primary: string; secondary?: string } {
  if (row.displayName) return { primary: row.displayName }
  const apts = (row.units || []).map(shortUnit).join(', ') || row.beCode || ''
  const owner = prettyBe(row.beName || '')
  return apts ? { primary: apts, secondary: owner || undefined } : { primary: owner || row.beCode || '' }
}
