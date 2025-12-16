import React from 'react'
import { useAuth } from '../../hooks/useAuth'

export type BillItem =
  | { key: string; label: string; kind: 'meter'; meterId: string }
  | { key: string; label: string; kind: 'expense'; expenseTypeCode: string; description?: string; currency?: string }

export type BillTemplate = {
  code?: string
  title: string
  items: BillItem[]
  values?: Record<string, string | number>
  state?: 'NEW' | 'FILLED' | 'CLOSED'
}

export function BillForm({
  communityId,
  periodCode,
  template,
  onChanged,
  canEdit = true,
}: {
  communityId: string
  periodCode: string
  template: BillTemplate
  onChanged?: () => void
  canEdit?: boolean
}) {
  // Defensive guard – if the template is malformed, bail out early so we don't crash the UI.
  const safeItems = Array.isArray(template?.items) ? template.items : []
  if (!template || !safeItems) return null

  const { api } = useAuth()
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(template.values || {}).map(([k, v]) => [k, String(v)])),
  )
  const [expenseTypeMap, setExpenseTypeMap] = React.useState<Record<string, { id: string; currency?: string | null; name?: string }>>({})
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const items = safeItems
  const hasPrefill = Object.keys(template.values || {}).length > 0
  const [billState, setBillState] = React.useState<'NEW' | 'FILLED' | 'CLOSED'>(template.state || (hasPrefill ? 'FILLED' : 'NEW'))

  // Reset local state when switching templates
  React.useEffect(() => {
    const nextValues = Object.fromEntries(Object.entries(template.values || {}).map(([k, v]) => [k, String(v)]))
    setValues(nextValues)
    const hasPrefillNow = Object.keys(nextValues).length > 0
    setBillState(template.state || (hasPrefillNow ? 'FILLED' : 'NEW'))
  }, [template])

  // Preload expense types (for expenses) and current values (meters + expenses)
  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    const tmplItems = Array.isArray(template?.items) ? template.items : []
    // seed with values passed from backend template, if any
    if (template.values) {
      setValues((prev) => ({ ...Object.fromEntries(Object.entries(template.values).map(([k, v]) => [k, String(v)])), ...prev }))
    }
    Promise.all([
      api.get<{ types: Array<{ id: string; code: string; name: string; currency?: string | null }> }>(
        `/communities/${communityId}/periods/${periodCode}/expenses/status`,
      ),
      api.get<{ items: Array<{ allocatableAmount: number; expenseType?: { code: string }; description: string }> }>(
        `/communities/${communityId}/periods/${periodCode}/expenses`,
      ),
    ])
      .then(([status, exp]) => {
        const map: Record<string, { id: string; currency?: string | null; name?: string }> = {}
        status.types.forEach((t) => (map[t.code] = { id: t.id, currency: t.currency, name: t.name }))
        setExpenseTypeMap(map)
        const vals: Record<string, string> = {}
        tmplItems.forEach((item) => {
          if (item.kind === 'expense') {
            const match = exp.items.find((e) => e.expenseType?.code === item.expenseTypeCode)
            if (match) vals[item.key] = String(Number(match.allocatableAmount))
          }
        })
        setValues((prev) => ({ ...prev, ...vals }))
      })
      .catch((err: any) => setMessage(err?.message || 'Failed to load expenses'))

    // Load meters individually
    tmplItems
      .filter((i) => i.kind === 'meter')
      .forEach((m) => {
        api
          .get<any>(`/communities/${communityId}/periods/${periodCode}/meters/${(m as any).meterId}`)
          .then((res) => {
            if (res?.value != null) setValues((prev) => ({ ...prev, [m.key]: String(Number(res.value)) }))
          })
          .catch(() => null)
      })
  }, [api, communityId, periodCode, template?.items])

  const onChange = (key: string, val: string) => setValues((prev) => ({ ...prev, [key]: val }))

  const save = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const calls: Array<Promise<any>> = []
      items.forEach((item) => {
        const val = values[item.key]
        if (val === undefined || val === null || val === '') return
        const num = Number(val)
        if (Number.isNaN(num)) return
        if (item.kind === 'meter') {
          calls.push(
            api.post(`/communities/${communityId}/periods/${periodCode}/meters`, {
              meterId: item.meterId,
              value: num,
            }),
          )
        } else {
          const expType = expenseTypeMap[item.expenseTypeCode]
          if (!expType?.id) return
          calls.push(
            api.post(`/communities/${communityId}/periods/${periodCode}/expenses`, {
              description: item.description || expType.name || item.label,
              amount: num,
              currency: item.currency || expType.currency || 'RON',
              expenseTypeId: expType.id,
            }),
          )
        }
      })
      await Promise.all(calls)
      setMessage('Saved')
      setBillState('FILLED')
      if (template.code) {
        await api.post(`/communities/${communityId}/periods/${periodCode}/bill-templates/${template.code}/state`, {
          state: 'FILLED',
          values,
        })
      }
      onChanged?.()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }
  async function updateState(next: 'FILLED' | 'CLOSED') {
    setLoading(true)
    setMessage(null)
    try {
      setBillState(next)
      if (template.code) {
        await api.post(`/communities/${communityId}/periods/${periodCode}/bill-templates/${template.code}/state`, {
          state: next,
          values,
        })
      }
      setMessage(`State set to ${next}`)
      onChanged?.()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to update state')
      // revert optimistic state if call failed
      setBillState((prev) => (prev === next ? 'FILLED' : prev))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card soft" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h4>{template.title}</h4>
          <div className="muted">Period {periodCode}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <div className={`badge ${billState === 'CLOSED' ? 'positive' : billState === 'FILLED' ? 'secondary' : 'warn'}`}>
            {billState}
          </div>
          {message && <div className="badge">{message}</div>}
        </div>
      </div>
      {billState === 'CLOSED' || !canEdit ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="muted">Digest</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 12 }}>
            {items.map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong>: {values[item.key] ?? '—'} {item.kind === 'meter' ? '' : ''}
              </li>
            ))}
          </ul>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" type="button" onClick={() => updateState('FILLED')} disabled={loading}>
              Reopen
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 6 }}>
            {items.map((item) => (
              <div key={item.key} className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="label" style={{ minWidth: 220 }}>{item.label}</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={values[item.key] ?? ''}
                  onChange={(e) => onChange(item.key, e.target.value)}
                  placeholder="0.00"
                  style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
                  disabled={!canEdit || billState === 'CLOSED'}
                />
                <div className="muted" style={{ fontSize: 12 }}>
                  {item.kind === 'meter' ? item.meterId : item.expenseTypeCode}
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={save} disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </button>
            <button className="btn secondary" type="button" onClick={() => updateState('CLOSED')} disabled={loading}>
              Confirm
            </button>
          </div>
        </>
      )}
    </div>
  )
}
