import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type Row = {
  unitId: string; code: string; label: string
  residents: number | null; sqm: number | null
  prevResidents: number | null; prevSqm: number | null
}
type Data = { period: { code: string; status: string; editable: boolean }; units: Row[] }
type Field = 'residents' | 'sqm'

const fmtSqm = (n: number | null | undefined) => (n == null ? '' : n.toFixed(3))

/** Per-unit residents count + sqm (cotă) confirmation. Editable for a non-closed period (admin);
 *  read-only for closed periods and oversight roles — shows the values that applied for that period.
 *  `field`, when given, narrows the table to just that one column, shows its live total, a
 *  "copy from last month" button, and a per-row increased/decreased/same indicator against last
 *  month's own value (used by the close wizard's separate CPI/residents steps); omitted, both
 *  columns show together with none of that (Period settings' combined view). `onSaved` fires after
 *  a successful save either way. */
export function UnitAttributesTable({ communityId, periodCode, editable = false, field, onSaved }: {
  communityId: string; periodCode: string; editable?: boolean; field?: Field; onSaved?: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [data, setData] = React.useState<Data | null>(null)
  const [res, setRes] = React.useState<Record<string, string>>({})
  const [sqm, setSqm] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [lastChanges, setLastChanges] = React.useState<Array<{ label: string; from: string; to: string }> | null>(null)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMsg(null); setError(null)
    api.get<Data>(`/communities/${communityId}/periods/${periodCode}/unit-attributes`)
      .then((d: Data) => {
        setData(d)
        setRes(Object.fromEntries(d.units.map((u) => [u.unitId, u.residents == null ? '' : String(u.residents)])))
        setSqm(Object.fromEntries(d.units.map((u) => [u.unitId, fmtSqm(u.sqm)])))
      })
      .catch((e: any) => { setData(null); setError(e?.message || 'Failed') })
  }, [api, communityId, periodCode])

  const canEdit = editable && !!data?.period.editable
  const showResidents = field !== 'sqm'
  const showSqm = field !== 'residents'

  const sum = (map: Record<string, string>) => {
    const raw = (data?.units ?? []).reduce((s, u) => {
      const n = Number(map[u.unitId]); return s + (Number.isFinite(n) ? n : 0)
    }, 0)
    return Math.round(raw * 1000) / 1000
  }
  const totalResidents = sum(res)
  const totalSqm = sum(sqm)

  const copyFromLastMonth = () => {
    if (!data) return
    if (showResidents) setRes(Object.fromEntries(data.units.map((u) => [u.unitId, u.prevResidents == null ? '' : String(u.prevResidents)])))
    if (showSqm) setSqm(Object.fromEntries(data.units.map((u) => [u.unitId, fmtSqm(u.prevSqm)])))
  }

  // ↑ increased / ↓ decreased / = unchanged vs. last month's own value for this unit — independent
  // of whatever's currently saved for THIS period, so it stays meaningful across repeated saves.
  const trend = (current: string, prev: number | null): { symbol: string; color: string } | null => {
    if (prev == null) return null
    const n = Number(current)
    if (!Number.isFinite(n)) return null
    const diff = n - prev
    if (Math.abs(diff) < 0.0005) return { symbol: '=', color: 'var(--muted, #888)' }
    return diff > 0 ? { symbol: '↑', color: 'var(--accent, #2e7d32)' } : { symbol: '↓', color: 'var(--negative, #c62828)' }
  }

  async function save() {
    if (!data) return
    setBusy(true); setMsg(null); setError(null); setLastChanges(null)
    try {
      const residents: Record<string, number> = {}
      const sqmOut: Record<string, number> = {}
      const changes: Array<{ label: string; from: string; to: string }> = []
      for (const u of data.units) {
        const r = res[u.unitId]
        if (r !== '' && Number(r) !== u.residents) {
          residents[u.unitId] = Number(r)
          if (showResidents) changes.push({ label: u.label, from: u.residents == null ? '—' : String(u.residents), to: r })
        }
        const s = sqm[u.unitId]
        if (s !== '' && Number(s) !== u.sqm) {
          sqmOut[u.unitId] = Number(s)
          if (showSqm) changes.push({ label: u.label, from: u.sqm == null ? '—' : fmtSqm(u.sqm), to: fmtSqm(Number(s)) })
        }
      }
      await api.post(`/communities/${communityId}/periods/${periodCode}/unit-attributes`, { residents, sqm: sqmOut })
      // Move the diff baseline forward to what was just saved — otherwise a second save in the same
      // session would keep diffing against the very first load and misreport "no changes". prevResidents/
      // prevSqm (last month) are left untouched — they're independent of anything saved this period.
      setData((prev) => prev ? {
        ...prev,
        units: prev.units.map((u) => ({
          ...u,
          residents: u.unitId in residents ? residents[u.unitId] : u.residents,
          sqm: u.unitId in sqmOut ? sqmOut[u.unitId] : u.sqm,
        })),
      } : prev)
      setMsg(t('common.save', 'Salvat'))
      setLastChanges(changes)
      onSaved?.()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  if (!data) return <div className="muted" style={{ fontSize: 12 }}>{error || t('common.loading', 'Loading…')}</div>

  return (
    <div className="stack" style={{ gap: 8, width: '100%' }}>
      {error && <div className="badge negative">{error}</div>}
      {field && (
        <div className="stack" style={{ gap: 8, alignItems: 'center' }}>
          <div className="row" style={{ justifyContent: 'center', gap: 6, alignItems: 'baseline' }}>
            <span className="muted" style={{ fontSize: 13 }}>{t('unitAttr.total', 'Total')}:</span>
            <strong style={{ fontSize: 20 }}>{field === 'residents' ? totalResidents : totalSqm.toFixed(3)}</strong>
          </div>
          {canEdit && (
            <button type="button" className="btn ghost small" onClick={copyFromLastMonth}>
              {t('unitAttr.copyLastMonth', 'Copiază din luna trecută')}
            </button>
          )}
        </div>
      )}
      <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted,#666)' }}>
              <th style={{ padding: '3px 6px' }}>{t('unitAttr.unit', 'Unitate')}</th>
              {showResidents && <th style={{ padding: '3px 6px', textAlign: 'right' }}>{t('unitAttr.residents', 'Persoane')}</th>}
              {showSqm && <th style={{ padding: '3px 6px', textAlign: 'right' }}>{t('unitAttr.sqm', 'Cotă-parte / mp')}</th>}
            </tr>
          </thead>
          <tbody>
            {data.units.map((u) => {
              const resTrend = field ? trend(res[u.unitId] ?? '', u.prevResidents) : null
              const sqmTrend = field ? trend(sqm[u.unitId] ?? '', u.prevSqm) : null
              return (
              <tr key={u.unitId} style={{ borderTop: '1px solid var(--border,#eee)' }}>
                <td style={{ padding: '3px 6px' }}>{u.label}</td>
                {showResidents && (
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                    <span className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {canEdit
                        ? <input type="number" min={0} value={res[u.unitId] ?? ''} onChange={(e) => setRes((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 70, textAlign: 'right' }} />
                        : (u.residents ?? '—')}
                      {resTrend && <span title={resTrend.symbol === '=' ? t('unitAttr.same', 'la fel ca luna trecută') : resTrend.symbol === '↑' ? t('unitAttr.increased', 'crescut față de luna trecută') : t('unitAttr.decreased', 'scăzut față de luna trecută')} style={{ color: resTrend.color, fontWeight: 700 }}>{resTrend.symbol}</span>}
                    </span>
                  </td>
                )}
                {showSqm && (
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                    <span className="row" style={{ gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {canEdit
                        ? <input type="number" step="0.001" min={0} value={sqm[u.unitId] ?? ''} onChange={(e) => setSqm((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 90, textAlign: 'right' }} />
                        : fmtSqm(u.sqm) || '—'}
                      {sqmTrend && <span title={sqmTrend.symbol === '=' ? t('unitAttr.same', 'la fel ca luna trecută') : sqmTrend.symbol === '↑' ? t('unitAttr.increased', 'crescut față de luna trecută') : t('unitAttr.decreased', 'scăzut față de luna trecută')} style={{ color: sqmTrend.color, fontWeight: 700 }}>{sqmTrend.symbol}</span>}
                    </span>
                  </td>
                )}
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="stack" style={{ gap: 6, width: '100%' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn primary small" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
            {msg && <span className="badge positive">{msg}</span>}
            <span className="muted" style={{ fontSize: 11 }}>{t('unitAttr.note', 'Se aplică la recalcularea alocării.')}</span>
          </div>
          {lastChanges && (
            lastChanges.length ? (
              <div className="stack" style={{ gap: 2, fontSize: 12, textAlign: 'left' }}>
                <span className="muted">{t('unitAttr.changesSummary', 'Modificări')}:</span>
                {lastChanges.map((c, i) => (
                  <div key={i}>{c.label}: {c.from} → <strong>{c.to}</strong></div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>{t('unitAttr.noChanges', 'Nicio modificare — valorile anterioare au fost confirmate.')}</div>
            )
          )}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11 }}>{t('unitAttr.readonly', 'Valorile aplicate pentru această perioadă (doar vizualizare).')}</div>
      )}
    </div>
  )
}
