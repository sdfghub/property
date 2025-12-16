import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { BillForm, BillTemplate } from './BillForm'
import { AttachmentPane } from '../TemplateAttachments'

export function BillTemplatesHost({
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
  const [templates, setTemplates] = React.useState<BillTemplate[]>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeCode, setActiveCode] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    setActiveCode(null)
    setRefreshKey((k) => k + 1)
  }, [communityId, periodCode])

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    api
      .get<BillTemplate[]>(`/communities/${communityId}/periods/${periodCode}/bill-templates`)
      .then((rows) => {
        setTemplates(rows || [])
        if (!activeCode && rows?.length) {
          setActiveCode((rows[0] as any).code || rows[0].title || null)
        }
        const closed = (rows || []).filter((r: any) => (r as any).state === 'CLOSED').length
        onStatusChange?.({ total: rows?.length || 0, closed })
      })
      .catch((err: any) => setMessage(err?.message || 'Failed to load bill templates'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, communityId, periodCode, refreshKey])

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
          <BillForm
            communityId={communityId}
            periodCode={periodCode}
            template={merged}
            canEdit={canEdit}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
          <AttachmentPane
            communityId={communityId}
            periodCode={periodCode}
            templateCode={(merged as any).code || merged.title}
            templateType="BILL"
            canEdit={canEdit && ((merged as any).state || merged.state) !== 'CLOSED'}
          />
        </>
      ) : (
        <div className="muted">No bill template selected.</div>
      )}
    </div>
  )
}
