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
  const [csvMessage, setCsvMessage] = React.useState<string | null>(null)
  const [csvBusy, setCsvBusy] = React.useState(false)
  const [activeCode, setActiveCode] = React.useState<string | null>(null)
  const lastFetched = React.useRef<string | null>(null)
  const lastKey = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    const key = `${communityId}|${periodCode}`
    if (lastKey.current === key) return
    lastKey.current = key
    setMessage(null)
    setCsvMessage(null)
    setCsvBusy(false)
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
  const allowEdit = canEdit && ((merged as any)?.state || merged?.state) !== 'CLOSED'

  const handleCsvDownload = async () => {
    if (!merged) return
    setCsvMessage(null)
    setCsvBusy(true)
    try {
      const res: { fileName: string; contentType?: string; data: string } = await api.get(
        `/communities/${communityId}/periods/${periodCode}/meter-templates/${(merged as any).code || merged.title}/csv`,
      )
      if (!res?.data) {
        setCsvMessage('Empty CSV export')
        return
      }
      const byteString = atob(res.data)
      const bytes = new Uint8Array(byteString.length)
      for (let i = 0; i < byteString.length; i += 1) bytes[i] = byteString.charCodeAt(i)
      const blob = new Blob([bytes], { type: res.contentType || 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.fileName || 'meter-readings.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setCsvMessage(err?.message || 'Failed to export CSV')
    } finally {
      setCsvBusy(false)
    }
  }

  const handleCsvUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    if (!merged || !ev.target.files || !ev.target.files.length) return
    const file = ev.target.files[0]
    const form = new FormData()
    form.append('file', file)
    setCsvBusy(true)
    setCsvMessage(null)
    try {
      const res: any = await api.post(
        `/communities/${communityId}/periods/${periodCode}/meter-templates/${(merged as any).code || merged.title}/csv`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const ignored = Array.isArray(res?.ignored) ? res.ignored.length : 0
      setCsvMessage(`Imported ${res?.imported ?? 0} values${ignored ? `, ignored ${ignored}` : ''}. State: ${res?.state || 'NEW'}.`)
      lastFetched.current = null
      fetchTemplates(true)
    } catch (err: any) {
      setCsvMessage(err?.message || 'Failed to import CSV')
    } finally {
      setCsvBusy(false)
      ev.target.value = ''
    }
  }

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
          <div className="card soft" style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0 }}>CSV</h4>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn secondary" type="button" onClick={handleCsvDownload} disabled={csvBusy}>
                  Export CSV
                </button>
                {allowEdit && (
                  <label className="btn secondary" style={{ cursor: csvBusy ? 'not-allowed' : 'pointer' }}>
                    {csvBusy ? 'Importing…' : 'Import CSV'}
                    <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleCsvUpload} disabled={csvBusy} />
                  </label>
                )}
              </div>
            </div>
            {csvMessage && <div className="badge" style={{ marginTop: 6 }}>{csvMessage}</div>}
            {!allowEdit && <div className="muted" style={{ marginTop: 6 }}>Import disabled (template closed or period read-only).</div>}
          </div>
          <AttachmentPane
            communityId={communityId}
            periodCode={periodCode}
            templateCode={(merged as any).code || merged.title}
            templateType="METER"
            canEdit={allowEdit}
          />
        </>
      ) : (
        <div className="muted">{templates.length ? 'No meter template selected.' : 'No meter templates yet.'}</div>
      )}
    </div>
  )
}
