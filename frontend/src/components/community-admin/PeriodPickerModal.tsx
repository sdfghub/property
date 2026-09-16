import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { PeriodSummary } from '../../contexts/PeriodContext'

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'badge positive',
  PREPARED: 'badge secondary',
  CLOSED: 'badge',
  DRAFT: 'badge secondary',
}

// Year nav + a 12-month grid, months colored/labeled by status and disabled when no period exists
// for that month — mirrors the reference design's period picker (lovable.app /avizier).
export function PeriodPickerModal({
  periods,
  selectedCode,
  onSelect,
  onClose,
}: {
  periods: PeriodSummary[]
  selectedCode: string
  onSelect: (code: string) => void
  onClose: () => void
}) {
  const { t: rawT, lang } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const byCode = React.useMemo(() => new Map(periods.map((p) => [p.code, p])), [periods])
  const initialYear = React.useMemo(() => {
    const [y] = (selectedCode || periods[periods.length - 1]?.code || '').split('-').map(Number)
    return y || new Date().getFullYear()
  }, [selectedCode, periods])
  const [year, setYear] = React.useState(initialYear)

  const monthLabel = (m: number) =>
    new Date(2000, m, 1).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', { month: 'short' })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: 320, maxWidth: '100%' }}>
        <div className="stack" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>{t('period.pickTitle', 'Select period')}</strong>
            <button type="button" className="btn ghost small" onClick={onClose} aria-label={t('common.close', 'Close')}>✕</button>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <button type="button" className="btn ghost small" onClick={() => setYear((y) => y - 1)} aria-label={t('period.prevYear', 'Previous year')}>‹</button>
            <strong>{year}</strong>
            <button type="button" className="btn ghost small" onClick={() => setYear((y) => y + 1)} aria-label={t('period.nextYear', 'Next year')}>›</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {Array.from({ length: 12 }, (_, i) => i).map((m) => {
              const code = `${year}-${String(m + 1).padStart(2, '0')}`
              const period = byCode.get(code)
              const isSelected = code === selectedCode
              return (
                <button
                  key={code}
                  type="button"
                  disabled={!period}
                  onClick={() => { onSelect(code); onClose() }}
                  className={isSelected ? 'btn primary small' : 'btn secondary small'}
                  style={{ opacity: period ? 1 : 0.35, flexDirection: 'column', gap: 2, padding: '8px 4px' }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{monthLabel(m)}</span>
                  {period && <span className={STATUS_BADGE[period.status] || 'badge'} style={{ fontSize: 9 }}>{t(period.status, period.status)}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
