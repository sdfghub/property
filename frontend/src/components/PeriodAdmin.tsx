import React from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAuth } from '../hooks/useAuth'

const metaLoadInFlight = new Map<string, Promise<void>>()
const metaLoadCache = new Map<string, { periods: Array<{ code: string; seq: number; status: string }>; currentCode: string }>()

type Props = {
  communityId: string
  communityCode?: string
  onGoMeters?: () => void
  onGoExpenses?: () => void
}

export function PeriodAdmin({ communityId, communityCode, onGoMeters, onGoExpenses }: Props) {
  const { t } = useI18n()
  const { api } = useAuth()
  const periodRef = communityCode || communityId
  const [summary, setSummary] = React.useState<any | null>(null)
  const [periods, setPeriods] = React.useState<Array<{ code: string; seq: number; status: string }>>([])
  const [selectedCode, setSelectedCode] = React.useState<string>('')
  const [currentCode, setCurrentCode] = React.useState<string>('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const lastMetaLoadRef = React.useRef<string | null>(null)
  const lastSummaryLoadRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const metaKey = periodRef
    const cached = metaLoadCache.get(metaKey)
    if (cached && cached.periods.length) {
      setPeriods(cached.periods)
      setCurrentCode(cached.currentCode)
      setSelectedCode((prev) => prev || cached.currentCode)
      return
    }
    if (metaLoadInFlight.has(metaKey)) {
      metaLoadInFlight.get(metaKey)?.then(() => {
        const next = metaLoadCache.get(metaKey)
        if (next && next.periods.length) {
          setPeriods(next.periods)
          setCurrentCode(next.currentCode)
          setSelectedCode((prev) => prev || next.currentCode)
        }
      })
      return
    }
    if (lastMetaLoadRef.current === metaKey && periods.length) return
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const allPeriods = await api
          .get<Array<{ code: string; seq: number; status: string }>>(`/communities/${periodRef}/periods`)
          .catch(() => [])
        const ordered = (allPeriods || [])
          .filter((p) => p?.code)
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        const last = ordered[ordered.length - 1]
        const nextCode = last?.code || ''
        metaLoadCache.set(metaKey, { periods: ordered, currentCode: nextCode })
        lastMetaLoadRef.current = metaKey
        if (!mounted) return
        setPeriods(ordered)
        setCurrentCode(nextCode)
        setSelectedCode((prev) => prev || nextCode)
        setLoading(false)
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'Failed to load period summary')
          setLoading(false)
        }
        lastMetaLoadRef.current = null
      }
    }
    const promise = load().finally(() => {
      metaLoadInFlight.delete(metaKey)
    })
    metaLoadInFlight.set(metaKey, promise)
    return () => {
      mounted = false
    }
  }, [api, periodRef])

  React.useEffect(() => {
    if (!selectedCode) return
    const summaryKey = `${periodRef}:${selectedCode}`
    if (lastSummaryLoadRef.current === summaryKey && summary?.period?.code === selectedCode) return
    let mounted = true
    const loadSummary = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await api.get<any>(`/communities/${periodRef}/periods/${selectedCode}/summary`)
        if (mounted) setSummary(data)
        lastSummaryLoadRef.current = summaryKey
      } catch (err: any) {
        if (mounted) {
          setSummary(null)
          setError(err?.message || 'Failed to load period summary')
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }
    loadSummary()
    return () => {
      mounted = false
    }
  }, [api, communityId, selectedCode])

  const renderAllocations = () => {
    if (!summary?.allocations?.length) return <div className="muted">{t('card.period.noActive')}</div>
    return (
      <table className="table" style={{ width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{t('card.period.expenses')}</th>
            <th style={{ textAlign: 'right' }}>{t('alloc.expected') || 'Expected'}</th>
            <th style={{ textAlign: 'right' }}>{t('alloc.allocated') || 'Allocated'}</th>
            <th style={{ textAlign: 'right' }}>{t('alloc.delta') || 'Delta'}</th>
          </tr>
        </thead>
        <tbody>
          {summary.allocations.map((row: any) => (
            <tr key={row.expense_type}>
              <td>{row.expense_type}</td>
              <td style={{ textAlign: 'right' }}>{Number(row.expected).toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{Number(row.allocated).toFixed(2)}</td>
              <td style={{ textAlign: 'right', color: Math.abs(Number(row.delta)) < 0.01 ? '#7bd88a' : '#ffae42' }}>
                {Number(row.delta).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  const renderStatements = () => {
    if (!summary?.statements?.length) return <div className="muted">{t('statements.subtitle')}</div>
    return (
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {summary.statements.map((s: any) => (
          <div key={s.currency} className="card soft" style={{ minWidth: 180 }}>
            <div className="muted">{s.currency}</div>
            <div style={{ fontSize: 13 }}>
              {t('card.financials.charges')}: {Number(s.charges).toFixed(2)}
            </div>
            <div style={{ fontSize: 13 }}>
              {t('card.financials.payments')}: {Number(s.payments).toFixed(2)}
            </div>
            <div style={{ fontSize: 13 }}>
              {t('card.financials.dueStart', 'Opening balance')}: {Number(s.due_start ?? 0).toFixed(2)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {t('card.financials.balance')}: {Number(s.balance).toFixed(2)}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="muted">{t('card.period.select', 'Select period')}</div>
        <select
          className="input"
          style={{ minWidth: 180 }}
          value={selectedCode}
          onChange={(e) => setSelectedCode(e.target.value)}
        >
          {periods.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code}
            </option>
          ))}
        </select>
        {currentCode && selectedCode === currentCode ? (
          <span className="badge secondary">{t('card.period.current', 'Current')}</span>
        ) : null}
      </div>

      <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          {loading && <div className="spinner" aria-label="loading" />}
        </div>
        {error && <div className="badge negative" style={{ marginTop: 8 }}>{error}</div>}
        {!loading && !error && !summary && <div className="muted" style={{ marginTop: 6 }}>{t('card.period.noActive')}</div>}
        {summary && (
          <div className="stack" style={{ gap: 12, marginTop: 8 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="badge secondary">{summary.period?.code}</div>
              <div className="badge tertiary">{summary.period?.status}</div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="muted" style={{ fontWeight: 600 }}>{t('statements.heading')}</div>
              {renderStatements()}
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="muted" style={{ fontWeight: 600 }}>{t('card.period.expenses')}</div>
              {renderAllocations()}
            </div>
          </div>
        )}
      </div>

      <div className="card soft">
        <h4 style={{ marginTop: 0 }}>{t('card.period.digest', 'Status digest')}</h4>
        {selectedCode ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="badge secondary">{selectedCode}</div>
              <div className="badge tertiary">
                {periods.find((p) => p.code === selectedCode)?.status || '—'}
              </div>
            </div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="stack" style={{ gap: 4 }}>
                <button className="btn secondary small" type="button" onClick={onGoMeters} disabled={!onGoMeters}>
                  {t('card.period.gotoMeters', 'Open meters')}
                </button>
              </div>
              <div className="stack" style={{ gap: 4 }}>
                <button className="btn secondary small" type="button" onClick={onGoExpenses} disabled={!onGoExpenses}>
                  {t('card.period.gotoExpenses', 'Open expenses')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="muted">{t('card.period.noActive')}</div>
        )}
      </div>
    </div>
  )
}
