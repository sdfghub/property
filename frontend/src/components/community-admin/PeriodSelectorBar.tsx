import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { usePeriod } from '../../contexts/PeriodContext'
import { PeriodPickerModal } from './PeriodPickerModal'

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'badge positive',
  PREPARED: 'badge secondary',
  CLOSED: 'badge',
  DRAFT: 'badge secondary',
}

// Global period control — one bar shared by every tab (Avizier, Contoare, Overview, Dashboard)
// instead of each keeping its own local period selector. Sits above the tab content, per the
// reference design (lovable.app /avizier): prev/next steppers + a pill that opens a year/month grid.
export function PeriodSelectorBar() {
  const { t: rawT, lang } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const { periods, selectedCode, selectedPeriod, setSelectedCode } = usePeriod()
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const sorted = React.useMemo(() => periods.slice().sort((a, b) => a.seq - b.seq), [periods])
  const idx = sorted.findIndex((p) => p.code === selectedCode)

  const periodLabel = (code: string) => {
    const [y, m] = code.split('-').map(Number)
    if (!y || !m) return code
    return new Date(y, m - 1, 1).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', { month: 'short', year: 'numeric' })
  }
  // Explicit "MMM DD, YY" format requested for these two — not the app's usual locale-aware
  // formatting, so it's spelled out with en-US regardless of `lang`.
  const shortDate = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }) : null

  if (!periods.length) return null

  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', padding: '4px 0' }}>
      <button
        type="button"
        className="btn ghost small"
        disabled={idx <= 0}
        onClick={() => setSelectedCode(sorted[idx - 1].code)}
        title={t('avizier.prevPeriod', 'Previous period')}
        aria-label={t('avizier.prevPeriod', 'Previous period')}
      >
        ‹
      </button>
      <button
        type="button"
        className="btn secondary small"
        onClick={() => setPickerOpen(true)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, textTransform: 'capitalize' }}
      >
        {periodLabel(selectedCode)}
        {selectedPeriod && (
          <span className={STATUS_BADGE[selectedPeriod.status] || 'badge'} style={{ fontSize: 10 }}>
            {t(selectedPeriod.status, selectedPeriod.status)}
          </span>
        )}
        <span aria-hidden style={{ fontSize: 10 }}>▾</span>
      </button>
      <button
        type="button"
        className="btn ghost small"
        disabled={idx < 0 || idx >= sorted.length - 1}
        onClick={() => setSelectedCode(sorted[idx + 1].code)}
        title={t('avizier.nextPeriod', 'Next period')}
        aria-label={t('avizier.nextPeriod', 'Next period')}
      >
        ›
      </button>
      {selectedPeriod?.afisareDate && (
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          {t('avizier.afisare', 'Data Emiterii')}: <strong style={{ color: 'var(--text, #1d1d1f)' }}>{shortDate(selectedPeriod.afisareDate)}</strong>
        </span>
      )}
      {selectedPeriod?.dueDate && (
        <span className="muted" style={{ fontSize: 12 }}>
          {t('avizier.due', 'Data Scadenței')}: <strong style={{ color: 'var(--text, #1d1d1f)' }}>{shortDate(selectedPeriod.dueDate)}</strong>
        </span>
      )}
      {pickerOpen && (
        <PeriodPickerModal
          periods={periods}
          selectedCode={selectedCode}
          onSelect={setSelectedCode}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
