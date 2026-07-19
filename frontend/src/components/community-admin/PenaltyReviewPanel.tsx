import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { PenaltyOverrideModal } from './PenaltyOverrideModal'
import { beLabel } from './beLabel'

const money = (n?: number | null) => (n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Focused penalty-review list for the close wizard: only the current period's charged penalties + any
// manual override, with the ✎ adjust action (admin, PREPARED). Not the full avizier.
export function PenaltyReviewPanel({ communityId }: { communityId: string }) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [data, setData] = React.useState<any>(null)
  const [loading, setLoading] = React.useState(true)
  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState<string>('')
  const [ovrTarget, setOvrTarget] = React.useState<{ be: string; beName?: string; computed: number } | null>(null)
  const isAdmin = activeRole?.role === 'COMMUNITY_ADMIN'

  // Default to the newest period (the one being worked on), with the option to pick an earlier one.
  React.useEffect(() => {
    api.get<any[]>(`/communities/${communityId}/periods`).then((rows) => {
      const sorted = (rows || []).slice().sort((a: any, b: any) => (b.seq ?? 0) - (a.seq ?? 0))
      setPeriods(sorted)
      setPeriod((cur) => cur || sorted[0]?.code || '')
      if (!sorted.length) setLoading(false)
    }).catch(() => setLoading(false))
  }, [api, communityId])

  const load = React.useCallback(() => {
    if (!period) return
    setLoading(true)
    api.get<any>(`/communities/${communityId}/finance/penalties?period=${encodeURIComponent(period)}`).then((d: any) => { setData(d); setLoading(false) }).catch(() => { setData(null); setLoading(false) })
  }, [api, communityId, period])
  React.useEffect(() => { load() }, [load])

  const dp = data?.period
  const canOverride = isAdmin && dp?.status === 'PREPARED'
  const rows: any[] = data?.rows || []

  return (
    <div className="card ops-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ margin: 0 }}>{t('penreview.title', 'Penalizări — revizuire')}
          {dp?.status ? <span className={`badge ${dp.status === 'CLOSED' ? 'secondary' : 'tertiary'}`} style={{ marginLeft: 8 }}>{dp.status}</span> : null}</h4>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
          </select>
          <button className="btn ghost small" onClick={load}>{t('common.refresh', 'Refresh')}</button>
        </div>
      </div>
      {loading ? <div className="empty" style={{ marginTop: 10 }}>{t('common.loading', 'Loading…')}</div> : (
      <>
      {isAdmin && !canOverride ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('penreview.prepareFirst', 'Ajustările manuale sunt disponibile după „Prepare”.')}</div> : null}
      {isAdmin && !canOverride ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('penreview.prepareFirst', 'Ajustările manuale sunt disponibile după „Prepare”.')}</div> : null}
      {!rows.length ? (
        <div className="empty" style={{ marginTop: 10 }}>{t('penreview.none', 'Nicio penalizare în această perioadă.')}</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ textAlign: 'right', borderBottom: '2px solid var(--border,#ccc)' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px' }}>{t('penreview.be', 'Proprietar')}</th>
              <th style={{ padding: '6px 10px' }}>{t('penreview.computed', 'Penalizare calculată')}</th>
              <th style={{ padding: '6px 10px' }}>{t('penreview.override', 'Aprobat')}</th>
              {canOverride ? <th style={{ padding: '6px 10px' }} /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.beCode} style={{ textAlign: 'right', borderBottom: '1px solid var(--border,#eee)' }}>
                <td style={{ textAlign: 'left', padding: '6px 10px' }}>{beLabel(r).primary}</td>
                <td style={{ padding: '6px 10px', color: 'var(--danger,#b45309)' }}>{money(r.computed)}</td>
                <td style={{ padding: '6px 10px', color: r.override != null ? 'var(--info,#1565c0)' : 'var(--muted,#999)', fontWeight: r.override != null ? 700 : 400 }}>
                  {r.override != null ? money(r.override) : '—'}
                </td>
                {canOverride ? (
                  <td style={{ padding: '6px 10px' }}>
                    <button className="btn ghost small" onClick={() => setOvrTarget({ be: r.beCode, beName: r.beName, computed: r.computed })}>✎ {t('penreview.adjust', 'Ajustează')}</button>
                  </td>
                ) : null}
              </tr>
            ))}
            <tr style={{ textAlign: 'right', fontWeight: 700, borderTop: '2px solid var(--border,#ccc)' }}>
              <td style={{ textAlign: 'left', padding: '8px 10px' }}>{t('penreview.total', 'Total')}</td>
              <td style={{ padding: '8px 10px', color: 'var(--danger,#b45309)' }}>{money(data?.totalComputed)}</td>
              <td style={{ padding: '8px 10px' }}>{data?.totalNet !== data?.totalComputed ? money(data?.totalNet) : '—'}</td>
              {canOverride ? <td /> : null}
            </tr>
          </tbody>
        </table>
      )}
      </>
      )}
      {ovrTarget && period && (
        <PenaltyOverrideModal communityId={communityId} period={period}
          be={ovrTarget.be} beName={ovrTarget.beName} computed={ovrTarget.computed}
          onClose={() => setOvrTarget(null)} onSaved={() => { setOvrTarget(null); load() }} />
      )}
    </div>
  )
}
