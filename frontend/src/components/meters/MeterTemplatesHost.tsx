import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { MeterEntryForm } from './MeterEntryForm'
import { AttachmentPane } from '../TemplateAttachments'

type MeterTemplate = {
  code?: string
  title: string
  items: Array<{ key: string; label: string; kind: 'meter'; meterId?: string; typeCode?: string }>
  values?: Record<string, string | number>
  state?: 'NEW' | 'FILLED' | 'CLOSED'
}

export function MeterTemplatesHost({
  communityId,
  periodCode,
  canEdit = true,
  onStatusChange,
}: {
  communityId: string
  periodCode: string
  canEdit?: boolean
  onStatusChange?: (summary: { total: number; closed: number }) => void
}) {
  const { api } = useAuth()
  const [templates, setTemplates] = React.useState<MeterTemplate[]>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeCode, setActiveCode] = React.useState<string | null>(null)
  const lastFetched = React.useRef<string | null>(null)
  const lastKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    const key = `${communityId}|${periodCode}`
    if (lastKey.current === key) return
    lastKey.current = key
    setMessage(null)
    setActiveCode(null)
    lastFetched.current = null
  }, [communityId, periodCode])

  const fetchTemplates = React.useCallback(
    async (force = false) => {
      if (!communityId || !periodCode) return
      const key = `${communityId}|${periodCode}`
      if (!force && lastFetched.current === key) return
      lastFetched.current = key
      setMessage(null)
      try {
        const rows = await api.get<MeterTemplate[]>(`/communities/${communityId}/periods/${periodCode}/meter-templates`)
        setTemplates(rows || [])
        if (!activeCode && rows?.length) {
          setActiveCode((rows[0] as any).code || rows[0].title || null)
        }
        const closed = (rows || []).filter((r: any) => (r as any).state === 'CLOSED').length
        onStatusChange?.({ total: rows?.length || 0, closed })
      } catch (err: any) {
        lastFetched.current = null
        setMessage(err?.message || 'Failed to load meter templates')
      }
    },
    [api, communityId, periodCode, onStatusChange], // avoid refiring when activeCode is set
  )

  React.useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  if (message) return <div className="badge negative">{message}</div>
  if (!templates.length) return null

  const active = templates.find((t) => ((t as any).code || t.title) === activeCode) || templates[0]
  const body: any = active ? (active as any).template || active : null
  const merged = active
    ? {
        ...body,
        code: (active as any).code || body.code,
        state: (active as any).state || body.state,
        values: body.values,
      }
    : null

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {templates
          .slice()
          .sort((a, b) => ((a as any).order ?? 0) - ((b as any).order ?? 0))
          .map((tpl) => {
            const code = (tpl as any).code || (tpl as any).title
            const tplState = (tpl as any).state || (tpl as any).template?.state
            return (
              <button
                key={code}
                className="btn secondary"
                type="button"
                onClick={() => setActiveCode(code)}
                style={{
                  background: activeCode === code ? 'rgba(43,212,213,0.15)' : undefined,
                  borderColor: activeCode === code ? 'rgba(43,212,213,0.5)' : undefined,
                }}
              >
                {(tpl as any).name || code}{' '}
                {tplState ? (
                  <span className={`badge ${tplState === 'CLOSED' ? 'positive' : tplState === 'FILLED' ? 'secondary' : 'warn'}`}>
                    {tplState}
                  </span>
                ) : null}
              </button>
            )
          })}
      </div>

      {merged ? (
        <>
          <MeterEntryForm
            communityId={communityId}
            periodCode={periodCode}
            template={merged}
            onChanged={() => {
              lastFetched.current = null
              fetchTemplates(true)
            }}
          />
          <AttachmentPane
            communityId={communityId}
            periodCode={periodCode}
            templateCode={(merged as any).code || merged.title}
            templateType="METER"
            canEdit={canEdit && ((merged as any).state || merged.state) !== 'CLOSED'}
          />
        </>
      ) : (
        <div className="muted">No meter template selected.</div>
      )}
    </div>
  )
}
