import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

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
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const baseItems = Array.isArray(template?.items) ? template.items : []
  const [values, setValues] = React.useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(template.values || {}).map(([k, v]) => [k, String(v)])),
  )
  const hasPrefill = Object.keys(template.values || {}).length > 0
  const [state, setState] = React.useState<'NEW' | 'FILLED' | 'CLOSED'>(template.state || (hasPrefill ? 'FILLED' : 'NEW'))
  const [message, setMessage] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [items, setItems] = React.useState<MeterItem[]>(baseItems)
  // INDEX vs CONSUMPTION per measure type, previous reading per meter, and reading history.
  const [modeByType, setModeByType] = React.useState<Record<string, string>>({})
  const [prevByMeter, setPrevByMeter] = React.useState<Record<string, number | null>>({})
  // Self-reported (non-admin) marker per meter, for admin highlight.
  const [flagByMeter, setFlagByMeter] = React.useState<Record<string, { selfReported?: boolean; enteredByName?: string | null }>>({})
  const [historyByMeter, setHistoryByMeter] = React.useState<Record<string, any[]>>({})
  const [openHistory, setOpenHistory] = React.useState<Set<string>>(new Set())

  const modeOf = (typeCode?: string) => (typeCode && modeByType[typeCode] === 'INDEX' ? 'INDEX' : 'CONSUMPTION')

  React.useEffect(() => {
    if (!communityId) return
    api.get<any>(`/communities/${communityId}/measure-modes`)
      .then((r: any) => {
        const m: Record<string, string> = {}
        ;(r?.types || []).forEach((t: any) => { m[t.code] = t.mode })
        setModeByType(m)
      })
      .catch(() => {})
  }, [api, communityId])

  const toggleHistory = (meterId: string) => {
    setOpenHistory((prev) => {
      const next = new Set(prev)
      if (next.has(meterId)) { next.delete(meterId); return next }
      next.add(meterId)
      if (!historyByMeter[meterId]) {
        api.get<any>(`/communities/${communityId}/meters/${meterId}/history`)
          .then((r: any) => setHistoryByMeter((h) => ({ ...h, [meterId]: r?.history || [] })))
          .catch(() => setHistoryByMeter((h) => ({ ...h, [meterId]: [] })))
      }
      return next
    })
  }

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
                label: it.label || m.notes || m.meterId,
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

  // Previous reading per meter (for INDEX consumption preview).
  React.useEffect(() => {
    if (!communityId || !periodCode) return
    items
      .filter((it) => it.kind === 'meter' && (it as any).meterId)
      .forEach((it) => {
        const mid = (it as any).meterId as string
        api.get<any>(`/communities/${communityId}/periods/${periodCode}/meters/${mid}`)
          .then((r: any) => {
            setPrevByMeter((p) => ({ ...p, [mid]: r?.previousReading ?? null }))
            setFlagByMeter((f) => ({ ...f, [mid]: { selfReported: !!r?.selfReported, enteredByName: r?.enteredByName ?? null } }))
          })
          .catch(() => {})
      })
  }, [api, communityId, periodCode, items])

  const onChange = (key: string, val: string) => setValues((prev) => ({ ...prev, [key]: val }))

  // Strip the building/stair prefix (e.g. "400191-C1-U6-AP 1" → "U6-AP 1") for a compact unit header.
  const prettyUnit = (code?: string | null) => (code ? code.replace(/^\d+-C\d+-/, '') : '')
  // Drop the redundant "Contor - " prefix (e.g. "Contor - Apa Rece 1" → "Apa Rece 1"); the unit is in the header.
  const shortMeterLabel = (label?: string) => (label || '').replace(/^\s*contor\s*[-–:]\s*/i, '')
  // A meter's contribution to its unit total: consumption (INDEX: entered − previous) or the raw value.
  const effectiveValue = (item: any) => {
    const entered = Number(values[item.key])
    if (Number.isNaN(entered)) return 0
    if (modeOf(item.typeCode) === 'INDEX') {
      const prev = item.meterId ? prevByMeter[item.meterId] ?? null : null
      return prev != null ? Math.max(0, entered - prev) : entered
    }
    return entered
  }
  // Group items by unit (community / no-unit first), preserving template order within each group.
  const groupedItems = React.useMemo(() => {
    const map = new Map<string, MeterItem[]>()
    for (const it of items) {
      const k = (it as any).unitCode || ''
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(it)
    }
    return Array.from(map.entries())
  }, [items])

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
      setMessage(t('meter.saved', 'Saved'))
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
      setMessage(t('meter.stateSet', 'State set to') + ' ' + next)
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
          <div className="muted">{t('meter.digest', 'Digest')}</div>
          {groupedItems.map(([unitCode, groupItems]) => (
            <div key={unitCode || '__community'} style={{ marginBottom: 4 }}>
              <div className="muted" style={{ fontSize: 12 }}><strong>{unitCode ? `${t('meter.unit', 'Unitate')} ${prettyUnit(unitCode)}` : t('meter.community', 'Contoare comunitate')}</strong></div>
              <ul className="muted" style={{ margin: 0, paddingLeft: 12 }}>
                {groupItems.map((item) => (
                  <li key={item.key}>{shortMeterLabel(item.label)}: {values[item.key] ?? '—'}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn secondary" type="button" onClick={() => updateState('FILLED')} disabled={loading}>
              Reopen
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 12 }}>
            {groupedItems.map(([unitCode, groupItems]) => (
              <div key={unitCode || '__community'} className="stack" style={{ gap: 4, borderTop: '2px solid var(--border,#e5e5e5)', paddingTop: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{unitCode ? `${t('meter.unit', 'Unitate')} ${prettyUnit(unitCode)}` : t('meter.community', 'Contoare comunitate')}</strong>
                  {groupItems.filter((i) => i.kind === 'meter').length > 1 && (
                    <span className="muted" style={{ fontSize: 12 }}>{t('meter.unitTotal', 'total unitate')}: <strong>{Number(groupItems.filter((i) => i.kind === 'meter').reduce((s, i) => s + effectiveValue(i), 0).toFixed(3))}</strong></span>
                  )}
                </div>
                {groupItems.map((item) => {
              const mid = (item as any).meterId as string | undefined
              const mode = modeOf((item as any).typeCode)
              const prev = mid ? prevByMeter[mid] ?? null : null
              const entered = Number(values[item.key])
              const consumption = mode === 'INDEX' && !Number.isNaN(entered)
                ? (prev != null ? Math.max(0, entered - prev) : entered)
                : null
              return (
              <div key={item.key} className="stack" style={{ gap: 2, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
                <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <label className="label" style={{ minWidth: 150 }} title={mid || undefined}>
                    {shortMeterLabel(item.label)}
                    <span className="muted" style={{ marginLeft: 6 }}>· {mode === 'INDEX' ? 'index' : 'consum'}</span>
                  </label>
                  <input
                    className="input"
                    type="number"
                    step="0.000001"
                    value={values[item.key] ?? ''}
                    onChange={(e) => onChange(item.key, e.target.value)}
                    placeholder={mode === 'INDEX' ? 'citire contor' : '0.00'}
                    style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
                    disabled={!canEdit}
                  />
                  {mid && flagByMeter[mid]?.selfReported && (
                    <span className="badge warn" title={t('meter.selfReportedTitle', 'Valoare introdusă de proprietar, nu de administrator')}>
                      {t('meter.readByOwner', '⚠ citit de proprietar')}{flagByMeter[mid]?.enteredByName ? ` (${flagByMeter[mid]?.enteredByName})` : ''}
                    </span>
                  )}
                  {mid && (
                    <button type="button" className="btn ghost small" onClick={() => toggleHistory(mid)}>
                      {openHistory.has(mid) ? 'ascunde istoric' : 'istoric'}
                    </button>
                  )}
                </div>
                {mode === 'INDEX' && (
                  <div className="muted" style={{ fontSize: 12, paddingLeft: 4 }}>
                    {prev != null ? `${t('meter.previousReading', 'citire anterioară')}: ${prev} → ` : `${t('meter.firstReading', 'prima citire')} → `}
                    consum: <strong>{consumption != null ? Number(consumption.toFixed(3)) : '—'}</strong>
                  </div>
                )}
                {mid && openHistory.has(mid) && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '4px 0 6px' }}>
                    <thead>
                      <tr style={{ textAlign: 'right', color: 'var(--muted,#666)' }}>
                        <th style={{ textAlign: 'left', padding: '2px 6px' }}>{t('meter.period', 'Perioadă')}</th>
                        <th style={{ padding: '2px 6px' }}>{t('meter.index', 'Index')}</th>
                        <th style={{ padding: '2px 6px' }}>{t('meter.consumption', 'Consum')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(historyByMeter[mid] || []).map((h: any, j: number) => (
                        <tr key={j} style={{ textAlign: 'right', borderTop: '1px solid var(--border,#eee)' }}>
                          <td style={{ textAlign: 'left', padding: '2px 6px' }}>
                            {h.periodCode}
                            {h.selfReported ? <span title={`citit de proprietar${h.enteredByName ? ` (${h.enteredByName})` : ''}`} style={{ color: 'var(--warn, #b45309)', marginLeft: 4 }}>⚠</span> : null}
                          </td>
                          <td style={{ padding: '2px 6px' }}>{h.reading ?? '—'}</td>
                          <td style={{ padding: '2px 6px' }}>{h.consumption ?? '—'}</td>
                        </tr>
                      ))}
                      {!(historyByMeter[mid] || []).length && (
                        <tr><td colSpan={3} className="muted" style={{ padding: '2px 6px' }}>{t('meter.noPreviousReadings', 'fără citiri anterioare')}</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
              )
            })}
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
