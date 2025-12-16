import React from 'react'
import { useAuth } from '../../hooks/useAuth'

type MeterItem = { key: string; label: string; kind: 'meter'; meterId?: string; typeCode?: string; unitCode?: string }
type MeterTemplate = { code?: string; title: string; items: MeterItem[]; values?: Record<string, string | number>; state?: 'NEW' | 'FILLED' | 'CLOSED' }

export function MeterEntryForm({
  communityId,
  periodCode,
  template,
  onChanged,
  canEdit = true,
}: {
  communityId: string
  periodCode: string
  template: MeterTemplate
  onChanged?: () => void
  canEdit?: boolean
}) {
  const { api } = useAuth()
  const baseItems = Array.isArray(template?.items) ? template.items : []
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(template.values || {}).map(([k, v]) => [k, String(v)])),
  )
  const hasPrefill = Object.keys(template.values || {}).length > 0
  const [state, setState] = React.useState<'NEW' | 'FILLED' | 'CLOSED'>(template.state || (hasPrefill ? 'FILLED' : 'NEW'))
  const [message, setMessage] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<MeterItem[]>(baseItems)

  // Reset local state when a new template is selected/refetched
  React.useEffect(() => {
    setMessage(null)
    setLoading(false)
    const prefilled = Object.entries(template.values || {}).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v)
      return acc
    }, {})
    setValues(prefilled)
    setState(template.state || (Object.keys(prefilled).length ? 'FILLED' : 'NEW'))
    setItems(baseItems)
  }, [template.code, template.state, template.values, baseItems])

  // Keep state in sync if template state changes after save/refresh
  React.useEffect(() => {
    if (template.state && template.state !== state) {
      setState(template.state)
    }
  }, [template.state, state])

  // Resolve meterIds for items that specify typeCode and expand to all meters of that type
  React.useEffect(() => {
    if (!communityId || !periodCode) return
    const unresolved = baseItems.filter((i) => i.kind === 'meter' && !i.meterId && i.typeCode)
    if (!unresolved.length) {
      setItems(baseItems)
      return
    }
    api
      .get<any[]>(`/communities/${communityId}/meters`)
      .then((rows) => {
        const expanded: MeterItem[] = []
        baseItems.forEach((it) => {
          if (it.kind === 'meter' && !it.meterId && it.typeCode) {
            const matches = rows.filter((r) => r.typeCode === it.typeCode)
            matches.forEach((m) => {
              const value = (template.values as any)?.[`${it.key}:${m.meterId}`] ?? (it as any).value ?? m.currentValue
              expanded.push({
                ...it,
                meterId: m.meterId,
                label: it.label || m.meterId,
                key: `${it.key}:${m.meterId}`,
                value,
                unitCode: m.unitCode || m.scopeCode,
              })
            })
          } else {
            expanded.push(it)
          }
        })
        setItems(expanded)
      })
      .catch(() => setItems(baseItems))
  }, [api, communityId, periodCode, baseItems])

  // Seed values from item.value if not already set
  React.useEffect(() => {
    const seeds: Record<string, string> = {}
    items.forEach((it: any) => {
      if (it.value != null && values[it.key] === undefined) {
        seeds[it.key] = String(it.value)
      }
    })
    if (Object.keys(seeds).length) setValues((prev) => ({ ...seeds, ...prev }))
  }, [items, values])

  const onChange = (key: string, val: string) => setValues((prev) => ({ ...prev, [key]: val }))

  const save = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const calls: Array<Promise<any>> = []
      items.forEach((item) => {
        if (item.kind !== 'meter') return
        const meterId = (item as any).meterId
        const val = values[item.key]
        if (!meterId || val === undefined || val === null || val === '') return
        calls.push(
          api.post(`/communities/${communityId}/periods/${periodCode}/meters`, {
            meterId,
            value: val,
          }),
        )
      })
      await Promise.all(calls)
      if (template.code) {
        await api.post(`/communities/${communityId}/periods/${periodCode}/meter-templates/${template.code}/state`, {
          state: 'FILLED',
          values,
        })
      }
      setState('FILLED')
      setMessage('Saved')
      onChanged?.()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  const updateState = async (next: 'FILLED' | 'CLOSED') => {
    setLoading(true)
    setMessage(null)
    try {
      setState(next)
      if (template.code) {
        await api.post(`/communities/${communityId}/periods/${periodCode}/meter-templates/${template.code}/state`, {
          state: next,
          values,
        })
      }
      setMessage(`State set to ${next}`)
      onChanged?.()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to update state')
      setState((prev) => (prev === next ? 'FILLED' : prev))
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
          <div className={`badge ${state === 'CLOSED' ? 'positive' : state === 'FILLED' ? 'secondary' : 'warn'}`}>{state}</div>
          {message && <div className="badge">{message}</div>}
        </div>
      </div>

      {state === 'CLOSED' ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="muted">Digest</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 12 }}>
            {items.map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong>: {values[item.key] ?? '—'}
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
                <label className="label" style={{ minWidth: 220 }}>
                  {item.label} {item.unitCode ? <span className="muted">(unit {item.unitCode})</span> : null}
                </label>
                <input
                  className="input"
                  type="number"
                  step="0.000001"
                  value={values[item.key] ?? ''}
                  onChange={(e) => onChange(item.key, e.target.value)}
                  placeholder="0.00"
                  style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
                  disabled={!canEdit || state === 'CLOSED'}
                />
                <div className="muted" style={{ fontSize: 12 }}>
                  {(item as any).meterId || item.typeCode}
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
