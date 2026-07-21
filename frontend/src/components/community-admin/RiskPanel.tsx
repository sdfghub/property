import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { beLabel } from './beLabel'

// #13 Risk exposure ("risc de expunere"): each billing entity's oldest unpaid arrear, aged from the
// scadență, mapped to an escalation tier. Reads GET /reports/risk. Note the backend ages
// penalty-tracked debt (see reports.service.riskExposure) — a companion to the collection-rate view.
type TierMeta = { key: string; label: string; hint?: string; maxDays: number | null; action: string; tone?: string; count: number; outstanding: number }
type Row = { beCode: string; beName?: string; displayName: string | null; units: string[]; oldestArrearDays: number; tier: string; tierLabel: string; action: string; outstanding: number }
type Report = {
  period: { code: string; status: string; endDate: string } | null
  tiers: TierMeta[]
  rows: Row[]
  totals: { count: number; outstanding: number }
}

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy}`

const TONE: Record<string, string> = { success: '#16a34a', warning: '#d97706', orange: '#ea580c', destructive: '#dc2626' }
const toneColor = (tone?: string) => TONE[tone || ''] || 'var(--muted, #888)'

export function RiskPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [periods, setPeriods] = React.useState<any[]>([])
  const [period, setPeriod] = React.useState<string>('')
  const [data, setData] = React.useState<Report | null>(null)
  const [loading, setLoading] = React.useState(true)
  const toneByKey = React.useMemo(() => new Map((data?.tiers ?? []).map((tr) => [tr.key, tr.tone])), [data])

  React.useEffect(() => {
    if (!communityId) return
    api.get<any[]>(`/communities/${communityId}/periods`)
      .then((rows: any[]) => setPeriods([...(rows || [])].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))))
      .catch(() => setPeriods([]))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    let alive = true
    setLoading(true)
    const qs = period ? `?period=${encodeURIComponent(period)}` : ''
    api.get<Report>(`/communities/${communityId}/reports/risk${qs}`)
      .then((d: Report) => { if (alive) { setData(d); setLoading(false); if (!period && d.period?.code) setPeriod(d.period.code) } })
      .catch(() => { if (alive) { setData(null); setLoading(false) } })
    return () => { alive = false }
  }, [api, communityId, period])

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <h4 style={{ margin: 0 }}>
          {t('risk.title', 'Risc de expunere')}
          {data?.period?.status ? <span className="badge secondary" style={{ marginLeft: 8 }}>{data.period.status}</span> : null}
        </h4>
        <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
        </select>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        {t('risk.hint', 'Vechimea celei mai vechi restanțe (de la scadență) încadrează fiecare unitate într-un nivel de risc. Se bazează pe datoria urmărită pentru penalizări.')}
      </div>

      {loading ? <div className="empty">{t('common.loading', 'Loading…')}</div> : !data ? (
        <div className="empty">{t('risk.none', 'Fără date pentru această perioadă.')}</div>
      ) : (
        <>
          {/* tier summary cards */}
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {data.tiers.map((tr) => (
              <div key={tr.key} className="card soft" style={{ flex: 1, minWidth: 160, borderLeft: `3px solid ${toneColor(tr.tone)}` }}>
                <div className="muted" style={{ fontSize: 12 }}>{tr.label}</div>
                <strong style={{ fontSize: 22, color: toneColor(tr.tone) }}>{tr.count}</strong>
                <div className="muted" style={{ fontSize: 11 }}>{tr.hint}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{money(tr.outstanding)}</div>
              </div>
            ))}
          </div>

          {/* per-BE list */}
          <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'right', background: 'var(--muted-bg, #f4f4f5)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>{t('risk.entity', 'Unitate')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('risk.days', 'Zile întârziere')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('risk.tier', 'Nivel')}</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>{t('risk.action', 'Acțiune')}</th>
                  <th style={{ padding: '8px 10px' }}>{t('risk.outstanding', 'Restanță penalizată')}</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                {data.rows.length === 0 ? (
                  <tr><td colSpan={5} className="muted" style={{ padding: 12, textAlign: 'center' }}>{t('risk.noRows', 'Nicio restanță urmărită.')}</td></tr>
                ) : data.rows.map((r) => {
                  const l = beLabel(r)
                  const color = toneColor(toneByKey.get(r.tier))
                  return (
                    <tr key={r.beCode} style={{ borderTop: '1px solid var(--border, #eee)', textAlign: 'right' }}>
                      <td style={{ textAlign: 'left', padding: '6px 10px' }}>
                        <span style={{ fontWeight: 600 }}>{l.primary}</span>
                        {l.secondary ? <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>{l.secondary}</span> : null}
                      </td>
                      <td style={{ padding: '6px 10px' }}>{r.oldestArrearDays}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'left' }}>
                        <span className="badge" style={{ background: color, color: '#fff' }}>{r.tierLabel}</span>
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'left', color: 'var(--muted, #666)' }}>{r.action}</td>
                      <td style={{ padding: '6px 10px' }}>{money(r.outstanding)}</td>
                    </tr>
                  )
                })}
                <tr style={{ borderTop: '2px solid var(--border, #ccc)', textAlign: 'right', fontWeight: 700, background: 'var(--muted-bg, #f4f4f5)' }}>
                  <td style={{ textAlign: 'left', padding: '8px 10px' }}>{t('risk.total', 'TOTAL')} ({data.totals.count})</td>
                  <td colSpan={3} />
                  <td style={{ padding: '8px 10px' }}>{money(data.totals.outstanding)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
