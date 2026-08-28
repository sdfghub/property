import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { MeterTemplatesHost } from './meters/MeterTemplatesHost'
import { usePeriodOptional } from '../contexts/PeriodContext'

export function CommunityMetersPanel({
  communityId,
  onStatusChange,
}: {
  communityId: string
  onStatusChange?: (summary: { total: number; closed: number }) => void
}) {
  const { api } = useAuth()
  const { t } = useI18n()
  const shared = usePeriodOptional()
  // Standalone fallback (no PeriodProvider ancestor): keep the old self-contained fetch so this
  // panel still works if ever embedded outside the community-admin dashboard.
  const [standaloneOpen, setStandaloneOpen] = React.useState<Array<{ id: string; code: string }>>([])
  const [standaloneClosed, setStandaloneClosed] = React.useState<Array<{ id: string; code: string }>>([])
  const [standaloneCode, setStandaloneCode] = React.useState('')
  const [message, setMessage] = React.useState<string | null>(null)
  const [meterStatus, setMeterStatus] = React.useState<{ total: number; closed: number }>({ total: 0, closed: 0 })
  const lastLoadKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (shared) return
    let mounted = true
    const load = async () => {
      if (!communityId) return
      const key = communityId
      if (lastLoadKey.current === key) return
      lastLoadKey.current = key
      setMessage(null)
      try {
        const [editableRes, openRes, closedRes] = await Promise.all([
          api.get<any>(`/communities/${communityId}/periods/editable`).catch(() => null),
          api.get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/open`).catch(() => []),
          api.get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/closed`).catch(() => []),
        ])
        if (!mounted) return
        setStandaloneOpen(openRes || [])
        setStandaloneClosed(closedRes || [])
        const chosen =
          editableRes?.period?.code ||
          (openRes && openRes[0]?.code) ||
          (closedRes && closedRes[0]?.code) ||
          ''
        setStandaloneCode(chosen)
      } catch (err: any) {
        if (!mounted) return
        setMessage(err?.message || 'Could not load periods')
      }
    }
    load()
    return () => {
      mounted = false
      lastLoadKey.current = null
    }
  }, [api, communityId, shared])

  const periods = shared ? shared.periods : [...standaloneOpen, ...standaloneClosed]
  const currentCode = shared ? shared.selectedCode : (standaloneCode || standaloneOpen[0]?.code || standaloneClosed[0]?.code || '')
  const setCurrentCode = shared ? shared.setSelectedCode : setStandaloneCode
  const currentStatus = shared ? shared.selectedPeriod?.status : (standaloneOpen.some((p) => p.code === currentCode) ? 'OPEN' : 'CLOSED')
  const canEdit = !!currentCode && currentStatus !== 'CLOSED'

  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <h4>{t('tab.meters')}</h4>
      {!shared && (
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label className="label">
              <span>{t('billing.periodLabel') || 'Period'}</span>
            </label>
            <select className="input" value={currentCode} onChange={(e) => setCurrentCode(e.target.value)}>
              {periods.map((p: any) => (
                <option key={p.id ?? p.code} value={p.code}>
                  {p.code}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div className="badge secondary">
          Templates closed: {meterStatus.closed}/{meterStatus.total || 0}
        </div>
        {!canEdit && <div className="badge warn">{t('cmeters.readOnly') || 'Read-only (period closed)'}</div>}
      </div>
      {communityId && currentCode ? (
        <MeterTemplatesHost
          communityId={communityId}
          periodCode={currentCode}
          canEdit={canEdit}
          onStatusChange={(s) => {
            setMeterStatus(s)
            onStatusChange?.(s)
          }}
        />
      ) : (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('exp.listEmpty')}
        </div>
      )}
      {message && <div className="badge negative" style={{ marginTop: 8 }}>{message}</div>}
    </div>
  )
}
