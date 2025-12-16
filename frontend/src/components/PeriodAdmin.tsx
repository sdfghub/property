import React from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAuth } from '../hooks/useAuth'
import { CommunityMetersPanel } from './CommunityMetersPanel'
import { CommunityExpensesPanel } from './CommunityExpensesPanel'

type Props = {
  communityId: string
  communityCode?: string
}

export function PeriodAdmin({ communityId, communityCode }: Props) {
  const { t } = useI18n()
  const { api } = useAuth()
  const [summary, setSummary] = React.useState<any | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const editable = await api.get<any>(`/communities/${communityId}/periods/editable`).catch(() => null)
        const code = editable?.period?.code
        if (!code) {
          if (mounted) {
            setSummary(null)
            setLoading(false)
          }
          return
        }
        const data = await api.get<any>(`/communities/${communityId}/periods/${code}/summary`)
        if (mounted) {
          setSummary(data)
          setLoading(false)
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || 'Failed to load period summary')
          setLoading(false)
        }
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [api, communityId])

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
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="badge secondary">b{t('nav.periodContext') || 'Period-specific operations'}</div>
        <div className="muted">
          {t('nav.periodBreadcrumb', {
            community: communityCode || communityId || 'N/A',
          })}
        </div>
      </div>

      <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>{t('card.period.summary') || 'Prepared period summary'}</h4>
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

      <CommunityMetersPanel communityId={communityId} />
      <CommunityExpensesPanel communityId={communityId} />
    </div>
  )
}
