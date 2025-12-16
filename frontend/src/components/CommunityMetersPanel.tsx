import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { MeterTemplatesHost } from './meters/MeterTemplatesHost'

export function CommunityMetersPanel({
  communityId,
  onStatusChange,
}: {
  communityId: string
  onStatusChange?: (summary: { total: number; closed: number }) => void
}) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [openPeriods, setOpenPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [closedPeriods, setClosedPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [periodCode, setPeriodCode] = React.useState('')
  const [message, setMessage] = React.useState<string | null>(null)
  const [editable, setEditable] = React.useState<{ period?: { code: string; status: string }; meters?: any; bills?: any; canClose?: boolean } | null>(null)
  const [meterStatus, setMeterStatus] = React.useState<{ total: number; closed: number }>({ total: 0, closed: 0 })
  const lastLoadKey = React.useRef<string | null>(null)

  React.useEffect(() => {
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
        setEditable(editableRes || null)
        setOpenPeriods(openRes || [])
        setClosedPeriods(closedRes || [])
        const chosen =
          editableRes?.period?.code ||
          (openRes && openRes[0]?.code) ||
          (closedRes && closedRes[0]?.code) ||
          ''
        setPeriodCode(chosen)
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
  }, [api, communityId])

  const currentCode = periodCode || openPeriods[0]?.code || closedPeriods[0]?.code || ''
  const editableCode = editable?.period?.code || openPeriods[0]?.code || ''
  const canEdit = currentCode === editableCode && !!editableCode

  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <h4>{t('tab.meters')}</h4>
      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">
            <span>{t('billing.periodLabel') || 'Period'}</span>
          </label>
          <select className="input" value={currentCode} onChange={(e) => setPeriodCode(e.target.value)} disabled>
            {[...openPeriods, ...closedPeriods].map((p) => (
              <option key={p.id} value={p.code}>
                {p.code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <div className="badge secondary">
          Templates closed: {meterStatus.closed}/{meterStatus.total || 0}
        </div>
        {!canEdit && <div className="badge warn">Read-only (period closed)</div>}
      </div>
      {communityId && currentCode && canEdit ? (
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
