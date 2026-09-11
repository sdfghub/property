import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

export type BillItem =
  | { key: string; label: string; kind: 'meter'; meterId: string; displayOrder?: number; unit?: string }
  | { key: string; label: string; kind: 'expense'; expenseTypeCode: string; description?: string; currency?: string; displayOrder?: number; arrears?: boolean; unit?: string }
  | { key: string; label: string; kind: 'spacer'; displayOrder?: number }

export type BillTemplate = {
  code?: string
  title: string
  items: BillItem[]
  values?: Record<string, string | number>
  state?: 'NEW' | 'FILLED' | 'CLOSED'
  output?: { mode?: string; invoice?: Record<string, string>; currency?: string }
}

/** Renders one or several bill templates as a single form — several templates when they share a
 *  vendor (one invoice, e.g. Aquatim's, covering apă rece + apă meteo): all their items appear
 *  together in `displayOrder` (falls back to source order when unset — see bill-templates.json;
 *  a `kind: 'spacer'` item renders as blank space, letting the layout mirror the actual paper
 *  invoice even across two underlying templates), one shared invoice-date field, one Save/Confirm
 *  that fans out to each template's own `/bill-templates/:code/state` underneath. `title`
 *  overrides the header (the vendor name, when called from BillTemplatesHost's grouped tabs);
 *  falls back to the first template's own title. */
export function BillForm({
  communityId,
  periodCode,
  templates,
  title,
  onChanged,
  canEdit = true,
}: {
  communityId: string
  periodCode: string
  templates: BillTemplate[]
  title?: string
  onChanged?: () => void
  canEdit?: boolean
}) {
  const safeTemplates = Array.isArray(templates) ? templates.filter(Boolean) : []

  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const mergedValues = (tpls: BillTemplate[]) => {
    const out: Record<string, string> = {}
    for (const tpl of tpls) for (const [k, v] of Object.entries(tpl?.values || {})) out[k] = String(v)
    return out
  }

  const [values, setValues] = React.useState<Record<string, string>>(() => mergedValues(safeTemplates))
  // Self-reported (non-admin) marker per meter item, for admin highlight.
  const [selfByKey, setSelfByKey] = React.useState<Record<string, { selfReported?: boolean; enteredByName?: string | null }>>({})
  const [loading, setLoading] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  // Flatten in source order first (stable base), then apply displayOrder — items without one keep
  // their relative position among themselves, at the position of the lowest displayOrder around them.
  const rawItems: BillItem[] = safeTemplates.flatMap((tpl) => (Array.isArray(tpl?.items) ? tpl.items : []))
  const items: BillItem[] = rawItems
    .map((item, index) => ({ item, index }))
    .sort((a, b) => ((a.item as any).displayOrder ?? a.index) - ((b.item as any).displayOrder ?? b.index))
    .map(({ item }) => item)
  const moneyItems = items.filter((i) => i.kind !== 'meter' && i.kind !== 'spacer')
  // All templates in a group share the same invoice — its shape (which keys carry the number/
  // dates/gross) is a fixed convention across every Kralik bill template, so the first one's
  // config applies to the whole group.
  const invoiceCfg: any = safeTemplates[0]?.output?.invoice
  const isInvoice = safeTemplates[0]?.output?.mode === 'VENDOR_INVOICE'
  const currency: string = safeTemplates[0]?.output?.currency || 'RON'
  const issueDateKey: string = invoiceCfg?.issueDateKey || 'invoiceDate'
  const dueDateKey: string = invoiceCfg?.dueDateKey || 'invoiceDueDate'
  const docIdentifierKey: string = invoiceCfg?.numberKey || 'invoiceNumber'
  const DOC_TYPE_KEY = 'docType'
  // Sum of the entered line items (never the meter reading or a spacer, neither is money) — shown
  // large in the header so the admin can eyeball it against the paper invoice/extras total before
  // Confirm.
  const total = moneyItems.reduce((s, i) => {
    const n = Number(values[i.key]); return s + (Number.isFinite(n) ? n : 0)
  }, 0)
  // Bill templates flag arrears items (e.g. Restanțe) with `arrears: true` — when a group has one,
  // the header splits the total into "current" vs "arrears" so the admin can tell them apart at a
  // glance, since they're allocated/paid differently.
  const arrearsItems = moneyItems.filter((i) => (i as any).arrears)
  const hasArrears = arrearsItems.length > 0
  const arrearsTotal = arrearsItems.reduce((s, i) => {
    const n = Number(values[i.key]); return s + (Number.isFinite(n) ? n : 0)
  }, 0)
  const currentTotal = total - arrearsTotal
  const hasPrefill = Object.keys(mergedValues(safeTemplates)).length > 0
  const allClosed = safeTemplates.length > 0 && safeTemplates.every((tpl) => tpl.state === 'CLOSED')
  const [billState, setBillState] = React.useState<'NEW' | 'FILLED' | 'CLOSED'>(
    allClosed ? 'CLOSED' : (safeTemplates[0]?.state && safeTemplates.every((tpl) => tpl.state === safeTemplates[0].state) ? safeTemplates[0].state : (hasPrefill ? 'FILLED' : 'NEW')),
  )
  const displayTitle = title || safeTemplates[0]?.title || ''

  // Reset local state when switching template groups
  React.useEffect(() => {
    const nextValues = mergedValues(safeTemplates)
    setValues(nextValues)
    const hasPrefillNow = Object.keys(nextValues).length > 0
    const closedNow = safeTemplates.length > 0 && safeTemplates.every((tpl) => tpl.state === 'CLOSED')
    setBillState(closedNow ? 'CLOSED' : (hasPrefillNow ? 'FILLED' : 'NEW'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeTemplates.map((tpl) => tpl.code).join(',')])

  // Preload expense types (for expenses) and current values (meters + expenses)
  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    const seeded = mergedValues(safeTemplates)
    if (Object.keys(seeded).length) setValues((prev) => ({ ...seeded, ...prev }))
    api
      .get<{ items: Array<{ allocatableAmount: number; expenseType?: { code: string }; description: string }> }>(
        `/communities/${communityId}/periods/${periodCode}/expenses`,
      )
      .then((exp) => {
        const vals: Record<string, string> = {}
        items.forEach((item) => {
          if (item.kind === 'expense') {
            const match = exp.items.find((e) => e.expenseType?.code === item.expenseTypeCode)
            if (match) vals[item.key] = String(Number(match.allocatableAmount))
          }
        })
        setValues((prev) => ({ ...prev, ...vals }))
      })
      .catch((err: any) => setMessage(err?.message || 'Failed to load expenses'))

    // Load meters individually
    items
      .filter((i) => i.kind === 'meter')
      .forEach((m) => {
        api
          .get<any>(`/communities/${communityId}/periods/${periodCode}/meters/${(m as any).meterId}`)
          .then((res) => {
            if (res?.value != null) setValues((prev) => ({ ...prev, [m.key]: String(Number(res.value)) }))
            if (res?.selfReported) setSelfByKey((s) => ({ ...s, [m.key]: { selfReported: true, enteredByName: res?.enteredByName ?? null } }))
          })
          .catch(() => null)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, communityId, periodCode, safeTemplates.map((tpl) => tpl.code).join(',')])

  if (!safeTemplates.length) return null

  const onChange = (key: string, val: string) => setValues((prev) => ({ ...prev, [key]: val }))

  // Push the current values as this group's state to every underlying template it covers — a
  // shared field like invoiceNumber lands harmlessly in a template that never reads it (only its
  // own items' keys get consumed at allocation time).
  const pushState = async (state: 'FILLED' | 'CLOSED') => {
    await Promise.all(
      safeTemplates
        .filter((tpl) => tpl.code)
        .map((tpl) => api.post(`/communities/${communityId}/periods/${periodCode}/bill-templates/${tpl.code}/state`, { state, values })),
    )
  }

  const save = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const meterCalls: Array<Promise<any>> = []
      items.forEach((item) => {
        if (item.kind !== 'meter') return
        const val = values[item.key]
        if (val === undefined || val === null || val === '') return
        const num = Number(val)
        if (Number.isNaN(num)) return
        meterCalls.push(
          api.post(`/communities/${communityId}/periods/${periodCode}/meters`, {
            meterId: item.meterId,
            value: num,
          }),
        )
      })
      // Save meter readings first: a meter reading recomputes aggregations/derived measures
      // (e.g. the water branch → residual), which the expense allocation then reads.
      await Promise.all(meterCalls)
      setMessage(t('bill.saved', 'Saved'))
      setBillState('FILLED')
      await pushState('FILLED')
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
      await pushState(next)
      setMessage(t('bill.stateSet', 'State set to') + ' ' + next)
      onChanged?.()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to update state')
      // revert optimistic state if call failed
      setBillState((prev) => (prev === next ? 'FILLED' : prev))
    } finally {
      setLoading(false)
    }
  }

  const docFields = () => (
    <>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label className="label" style={{ minWidth: 220 }}>{t('bill.docType', 'Tip document')}</label>
        <select
          className="input"
          value={values[DOC_TYPE_KEY] ?? 'invoice'}
          onChange={(e) => onChange(DOC_TYPE_KEY, e.target.value)}
          style={{ maxWidth: 180, fontWeight: 600 }}
          disabled={!canEdit}
        >
          <option value="invoice">{t('bill.docType.invoice', 'Factură')}</option>
          <option value="statement">{t('bill.docType.statement', 'Extras')}</option>
          <option value="other">{t('bill.docType.other', 'Altele')}</option>
        </select>
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label className="label" style={{ minWidth: 220 }}>{t('bill.docIdentifier', 'Identificator document')}</label>
        <input
          className="input"
          type="text"
          value={values[docIdentifierKey] ?? ''}
          onChange={(e) => onChange(docIdentifierKey, e.target.value)}
          placeholder={t('bill.docIdentifierPlaceholder', 'nr. factură / extras')}
          style={{ maxWidth: 220, height: 30, padding: '4px 8px' }}
          disabled={!canEdit}
        />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label className="label" style={{ minWidth: 220 }}>{t('bill.invoiceIssueDate', 'Data emiterii')}</label>
        <input
          className="input"
          type="date"
          value={values[issueDateKey] ?? ''}
          onChange={(e) => onChange(issueDateKey, e.target.value)}
          style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
          disabled={!canEdit}
        />
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <label className="label" style={{ minWidth: 220 }}>{t('bill.invoiceDueDate', 'Scadență factură')}</label>
        <input
          className="input"
          type="date"
          value={values[dueDateKey] ?? ''}
          onChange={(e) => onChange(dueDateKey, e.target.value)}
          style={{ maxWidth: 160, height: 30, padding: '4px 8px' }}
          disabled={!canEdit}
        />
        <div className="muted" style={{ fontSize: 12 }}>{t('bill.dueDate', 'due date')}</div>
      </div>
    </>
  )

  return (
    <div className="card soft" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{displayTitle}</h2>
        <div className="row" style={{ gap: 6 }}>
          <div className={`badge ${billState === 'CLOSED' ? 'positive' : billState === 'FILLED' ? 'secondary' : 'warn'}`}>
            {billState}
          </div>
          {message && <div className="badge">{message}</div>}
        </div>
      </div>
      <div className="row" style={{ alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginTop: 2 }}>
        {hasArrears ? (
          <>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('bill.totalCurrent', 'Curente')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{currentTotal.toFixed(2)} {currency}</div>
            </div>
            {/* Restanțe are visually distinguished (grayed) from the current total everywhere in the
                app (see AvizierPanel) — different money, different treatment, so it must never read
                as more of the same due amount. */}
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('bill.totalArrears', 'Restanțe')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--muted, #666)' }}>{arrearsTotal.toFixed(2)} {currency}</div>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{total.toFixed(2)} {currency}</div>
        )}
      </div>
      {(values[docIdentifierKey] || values[dueDateKey]) && (
        <div className="muted">
          {[values[docIdentifierKey], values[dueDateKey] ? `${t('bill.invoiceDueDate', 'Scadență factură')}: ${values[dueDateKey]}` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
      {billState === 'CLOSED' || !canEdit ? (
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="muted">{t('bill.digest', 'Digest')}</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 12 }}>
            {isInvoice && (
              <>
                <li><strong>{t('bill.docType', 'Tip document')}</strong>: {t(`bill.docType.${values[DOC_TYPE_KEY] || 'invoice'}`, values[DOC_TYPE_KEY] || 'Factură')}</li>
                <li><strong>{t('bill.docIdentifier', 'Identificator document')}</strong>: {values[docIdentifierKey] || '—'}</li>
                <li><strong>{t('bill.invoiceIssueDate', 'Data emiterii')}</strong>: {values[issueDateKey] || '—'}</li>
                <li><strong>{t('bill.invoiceDueDate', 'Scadență factură')}</strong>: {values[dueDateKey] || '—'}</li>
              </>
            )}
            {items.filter((item) => item.kind !== 'spacer').map((item) => (
              <li key={item.key}>
                <strong>{item.label}</strong>: {values[item.key] ?? '—'}{values[item.key] != null ? ` ${(item as any).unit || currency}` : ''}
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
            {isInvoice && docFields()}
            {isInvoice && <div style={{ height: 8, borderBottom: '1px dashed var(--border,#e0e0e0)', marginBottom: 4 }} />}
            {items.map((item) => (
              item.kind === 'spacer'
                ? <div key={item.key} style={{ height: 14 }} />
                : (
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
                  <div className="muted" style={{ fontSize: 12, minWidth: 28 }}>{(item as any).unit || currency}</div>
                  {item.kind === 'meter' && selfByKey[item.key]?.selfReported && (
                    <span className="badge warn" title={t('bill.selfReportedTitle', 'Valoare introdusă de proprietar, nu de administrator')}>
                      {t('bill.readByOwner', '⚠ citit de proprietar')}{selfByKey[item.key]?.enteredByName ? ` (${selfByKey[item.key]?.enteredByName})` : ''}
                    </span>
                  )}
                </div>
                )
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
