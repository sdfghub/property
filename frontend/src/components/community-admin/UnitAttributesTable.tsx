import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type Row = { unitId: string; code: string; label: string; residents: number | null; sqm: number | null }
type Data = { period: { code: string; status: string; editable: boolean }; units: Row[] }

/** Per-unit residents count + sqm (cotă) confirmation. Editable for a non-closed period (admin);
 *  read-only for closed periods and oversight roles — shows the values that applied for that period. */
export function UnitAttributesTable({ communityId, periodCode, editable = false }: { communityId: string; periodCode: string; editable?: boolean }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [data, setData] = React.useState<Data | null>(null)
  const [res, setRes] = React.useState<Record<string, string>>({})
  const [sqm, setSqm] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMsg(null); setError(null)
    api.get<Data>(`/communities/${communityId}/periods/${periodCode}/unit-attributes`)
      .then((d: Data) => {
        setData(d)
        setRes(Object.fromEntries(d.units.map((u) => [u.unitId, u.residents == null ? '' : String(u.residents)])))
        setSqm(Object.fromEntries(d.units.map((u) => [u.unitId, u.sqm == null ? '' : String(u.sqm)])))
      })
      .catch((e: any) => { setData(null); setError(e?.message || 'Failed') })
  }, [api, communityId, periodCode])

  const canEdit = editable && !!data?.period.editable

  async function save() {
    if (!data) return
    setBusy(true); setMsg(null); setError(null)
    try {
      const residents: Record<string, number> = {}
      const sqmOut: Record<string, number> = {}
      for (const u of data.units) {
        const r = res[u.unitId]; if (r !== '' && Number(r) !== u.residents) residents[u.unitId] = Number(r)
        const s = sqm[u.unitId]; if (s !== '' && Number(s) !== u.sqm) sqmOut[u.unitId] = Number(s)
      }
      await api.post(`/communities/${communityId}/periods/${periodCode}/unit-attributes`, { residents, sqm: sqmOut })
      setMsg(t('common.save', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  if (!data) return <div className="muted" style={{ fontSize: 12 }}>{error || t('common.loading', 'Loading…')}</div>

  return (
    <div className="stack" style={{ gap: 8 }}>
      {error && <div className="badge negative">{error}</div>}
      <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted,#666)' }}>
              <th style={{ padding: '3px 6px' }}>{t('unitAttr.unit', 'Unitate')}</th>
              <th style={{ padding: '3px 6px', textAlign: 'right' }}>{t('unitAttr.residents', 'Persoane')}</th>
              <th style={{ padding: '3px 6px', textAlign: 'right' }}>{t('unitAttr.sqm', 'Cotă-parte / mp')}</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((u) => (
              <tr key={u.unitId} style={{ borderTop: '1px solid var(--border,#eee)' }}>
                <td style={{ padding: '3px 6px' }}>{u.label}</td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  {canEdit
                    ? <input type="number" min={0} value={res[u.unitId] ?? ''} onChange={(e) => setRes((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 70, textAlign: 'right' }} />
                    : (u.residents ?? '—')}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  {canEdit
                    ? <input type="number" step="0.01" min={0} value={sqm[u.unitId] ?? ''} onChange={(e) => setSqm((m) => ({ ...m, [u.unitId]: e.target.value }))} style={{ width: 80, textAlign: 'right' }} />
                    : (u.sqm ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn primary small" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
          {msg && <span className="badge positive">{msg}</span>}
          <span className="muted" style={{ fontSize: 11 }}>{t('unitAttr.note', 'Se aplică la recalcularea alocării.')}</span>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 11 }}>{t('unitAttr.readonly', 'Valorile aplicate pentru această perioadă (doar vizualizare).')}</div>
      )}
    </div>
  )
}
