import React from 'react'
import { useI18n } from '../../../i18n/useI18n'
import { useMetadata, labelOf } from '../../../hooks/useMetadata'
import { DrawerShell } from '../../money/DrawerShell'
import { money } from '../../money/money-utils'
import type { Allocation, Blocker, IntakeContext, IntakeRecordRow, InvoiceHeader, InvoiceMapping } from './intake-types'

// Per-record editor: the agent's extraction on the left (read-only, with its rationale and warnings),
// the mapping the app will apply on the right (editable). Save re-runs the checks; Approve additionally
// needs every remaining overridable blocker ticked. Hard blockers cannot be ticked away.
type Props = {
  record: IntakeRecordRow
  ctx: IntakeContext | null
  busy: boolean
  onClose: () => void
  onSave: (body: { invoice?: Partial<InvoiceHeader>; mapping?: InvoiceMapping; overrides?: string[] }) => Promise<void>
  onApprove: (body: { invoice?: Partial<InvoiceHeader>; mapping?: InvoiceMapping; overrides?: string[] }) => Promise<void>
}

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
const str = (v: unknown) => (v == null ? '' : String(v))

export function IntakeRecordDrawer({ record, ctx, busy, onClose, onSave, onApprove }: Props) {
  const { t, lang } = useI18n()
  const meta = useMetadata()
  const localized = (m: any) => (m ? (lang === 'en' ? m.labelEn || m.label : m.label) : null)
  const localizedHint = (m: any) => (m ? (lang === 'en' ? m.hintEn || m.hint : m.hint) : null)
  const blockerMeta = (c: string) => meta?.intakeBlockers?.find((m) => m.key === c)

  const isInvoice = record.kind === 'INVOICE'
  const locked = record.status === 'APPLIED'
  const [inv, setInv] = React.useState<InvoiceHeader>(() => ({ ...(record.effective?.invoice ?? record.extracted ?? {}) }))
  // the server may have matched the vendor by CUI/name even when the agent left vendorId null — show that
  const initialMap = () => {
    const m: InvoiceMapping = structuredClone(record.effective?.mapping ?? { vendor: { match: 'UNKNOWN', vendorId: null, name: null, taxId: null, iban: null }, allocations: [], fallback: null, duplicateOf: null })
    const rv = record.resolved?.vendor
    if (!m.vendor.vendorId && rv?.vendorId) m.vendor = { ...m.vendor, match: 'EXISTING', vendorId: rv.vendorId, name: rv.name ?? m.vendor.name }
    return m
  }
  const [map, setMap] = React.useState<InvoiceMapping>(initialMap)
  const [overrides, setOverrides] = React.useState<string[]>(() => record.review?.overrides ?? [])
  React.useEffect(() => {
    setInv({ ...(record.effective?.invoice ?? record.extracted ?? {}) })
    setMap(initialMap())
    setOverrides(record.review?.overrides ?? [])
  }, [record])

  const setHeader = (k: keyof InvoiceHeader, v: unknown) => setInv((s) => ({ ...s, [k]: v }))
  const setAlloc = (i: number, patch: Partial<Allocation>) => setMap((m) => ({ ...m, allocations: m.allocations.map((a, j) => (j === i ? { ...a, ...patch } : a)) }))
  const addAlloc = () => setMap((m) => ({ ...m, allocations: [...m.allocations, { templateCode: ctx?.templates[0]?.code ?? '', itemKey: ctx?.templates[0]?.items[0]?.key ?? '', amount: 0, reason: null }], fallback: null }))
  const removeAlloc = (i: number) => setMap((m) => ({ ...m, allocations: m.allocations.filter((_, j) => j !== i) }))
  const useFallback = () => setMap((m) => ({ ...m, allocations: [], fallback: { fundCode: ctx?.funds[0]?.code ?? null, expenseTypeCode: null } }))
  const setVendor = (vendorId: string) => {
    const v = ctx?.vendors.find((x) => x.id === vendorId)
    setMap((m) => ({ ...m, vendor: v ? { match: 'EXISTING', vendorId: v.id, name: v.name, taxId: v.taxId, iban: v.iban } : { match: 'NEW', vendorId: null, name: m.vendor.name ?? inv.vendorName ?? null, taxId: m.vendor.taxId ?? inv.vendorTaxId ?? null, iban: m.vendor.iban ?? inv.vendorIban ?? null } }))
  }

  const sum = map.allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)
  const gross = inv.gross == null ? null : Number(inv.gross)
  const body = () => ({
    invoice: {
      vendorName: inv.vendorName, vendorTaxId: inv.vendorTaxId, vendorIban: inv.vendorIban, number: inv.number, issueDate: inv.issueDate, dueDate: inv.dueDate,
      servicePeriodStart: inv.servicePeriodStart, servicePeriodEnd: inv.servicePeriodEnd, currency: inv.currency, net: inv.net, vat: inv.vat, gross: inv.gross,
    },
    mapping: map,
    overrides,
  })
  const hard = record.blockers.filter((b) => !b.overridable)
  const soft = record.blockers.filter((b) => b.overridable)
  const toggle = (code: string) => setOverrides((o) => (o.includes(code) ? o.filter((c) => c !== code) : [...o, code]))

  return (
    <DrawerShell open onClose={onClose} width={900} title={<span>#{record.index} · {record.sourceFile ?? record.kind} <span className={`badge ${meta?.intakeRecordStatuses?.find((m) => m.key === record.status)?.tone || ''}`} style={{ marginLeft: 8 }}>{localized(meta?.intakeRecordStatuses?.find((m) => m.key === record.status)) || record.status}</span></span>}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* ── left: what the agent read ── */}
        <div className="stack" style={{ flex: '1 1 300px', gap: 10 }}>
          <div className="label">{t('intake.drawer.agent', 'What the agent read')}</div>
          {record.rationale && <div style={{ fontSize: 13 }}><em>{record.rationale}</em></div>}
          {record.confidence != null && <div className="muted" style={{ fontSize: 12 }}>{t('intake.col.confidence', 'Conf.')}: {Math.round(record.confidence * 100)}%</div>}
          <pre style={{ fontSize: 11, background: 'var(--field-bg)', padding: 10, borderRadius: 8, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.extracted, null, 2)}</pre>
          {record.kind === 'INVOICE' && record.proposal && (
            <details><summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>{t('intake.drawer.proposal', 'Agent\'s original mapping')}</summary>
              <pre style={{ fontSize: 11, background: 'var(--field-bg)', padding: 10, borderRadius: 8, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify(record.proposal, null, 2)}</pre>
            </details>
          )}
          {record.appliedRefs && <div className="muted" style={{ fontSize: 12 }}>{t('intake.drawer.applied', 'Applied')}: {(record.appliedRefs.vendorInvoiceIds ?? []).length} {t('intake.drawer.invoices', 'invoice(s)')}, {(record.appliedRefs.templateInstanceIds ?? []).length} {t('intake.drawer.templates', 'template(s)')}</div>}
          {record.error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{record.error}</div>}
        </div>

        {/* ── right: what will be applied ── */}
        <div className="stack" style={{ flex: '1 1 380px', gap: 10 }}>
          {!isInvoice ? (
            <div className="badge">{t('intake.drawer.phase2', 'Bank statement lines and other documents are stored for now; they can only be skipped in this version.')}</div>
          ) : (
            <>
              <div className="label">{t('intake.drawer.invoice', 'Invoice')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Field label={t('intake.form.number', 'Number')} value={str(inv.number)} onChange={(v) => setHeader('number', v || null)} disabled={locked} />
                <Field label={t('intake.form.issueDate', 'Issued')} value={str(inv.issueDate)} onChange={(v) => setHeader('issueDate', v || null)} disabled={locked} placeholder="YYYY-MM-DD" />
                <Field label={t('intake.form.dueDate', 'Due')} value={str(inv.dueDate)} onChange={(v) => setHeader('dueDate', v || null)} disabled={locked} placeholder="YYYY-MM-DD" />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Field label={t('intake.form.net', 'Net')} value={str(inv.net)} onChange={(v) => setHeader('net', num(v))} disabled={locked} />
                <Field label={t('intake.form.vat', 'VAT')} value={str(inv.vat)} onChange={(v) => setHeader('vat', num(v))} disabled={locked} />
                <Field label={t('intake.form.gross', 'Gross')} value={str(inv.gross)} onChange={(v) => setHeader('gross', num(v))} disabled={locked} />
                <Field label={t('intake.form.servicePeriod', 'Service period')} value={str(inv.servicePeriodStart)} onChange={(v) => setHeader('servicePeriodStart', v || null)} disabled={locked} placeholder="YYYY-MM" />
                <Field label="→" value={str(inv.servicePeriodEnd)} onChange={(v) => setHeader('servicePeriodEnd', v || null)} disabled={locked} placeholder="YYYY-MM" />
              </div>

              <div className="label">{t('intake.form.vendor', 'Vendor')}</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select className="input" value={map.vendor.vendorId ?? ''} disabled={locked} onChange={(e) => setVendor(e.target.value)}>
                  <option value="">{t('intake.form.vendorNew', '(new vendor)')}: {map.vendor.name ?? inv.vendorName ?? '?'}</option>
                  {ctx?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}{v.taxId ? ` · ${v.taxId}` : ''}</option>)}
                </select>
                {!map.vendor.vendorId && <Field label={t('intake.form.vendorName', 'Name')} value={str(map.vendor.name ?? inv.vendorName)} onChange={(v) => setMap((m) => ({ ...m, vendor: { ...m.vendor, match: 'NEW', name: v || null } }))} disabled={locked} />}
              </div>

              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="label" style={{ margin: 0 }}>{t('intake.form.allocations', 'Allocations to templates')}</div>
                {!locked && <div className="row" style={{ gap: 6 }}>
                  <button className="btn tertiary small" onClick={addAlloc}>{t('intake.form.addRow', '+ line')}</button>
                  <button className="btn tertiary small" onClick={useFallback}>{t('intake.form.useFallback', 'No template')}</button>
                </div>}
              </div>
              {map.allocations.length > 0 && (
                <table className="table" style={{ fontSize: 13 }}>
                  <thead><tr><th>{t('intake.form.template', 'Template')}</th><th>{t('intake.form.item', 'Item')}</th><th style={{ textAlign: 'right' }}>{t('intake.form.amount', 'Amount')}</th><th></th></tr></thead>
                  <tbody>
                    {map.allocations.map((a, i) => {
                      const tpl = ctx?.templates.find((x) => x.code === a.templateCode)
                      const submitted = tpl?.instanceState === 'SUBMITTED' || tpl?.instanceState === 'CLOSED'
                      return (
                        <tr key={i}>
                          <td>
                            <select className="input" value={a.templateCode} disabled={locked} onChange={(e) => { const nt = ctx?.templates.find((x) => x.code === e.target.value); setAlloc(i, { templateCode: e.target.value, itemKey: nt?.items[0]?.key ?? '' }) }}>
                              {!tpl && <option value={a.templateCode}>{a.templateCode} ?</option>}
                              {ctx?.templates.map((x) => <option key={x.code} value={x.code}>{x.code}{x.vendorName ? ` · ${x.vendorName}` : ''}{x.instanceState === 'SUBMITTED' || x.instanceState === 'CLOSED' ? ' ✓' : ''}</option>)}
                            </select>
                            {submitted && <div className="muted" style={{ fontSize: 11 }}>{t('intake.form.alreadySubmitted', 'already submitted this period')}</div>}
                          </td>
                          <td>
                            <select className="input" value={a.itemKey} disabled={locked} onChange={(e) => setAlloc(i, { itemKey: e.target.value })}>
                              {!tpl?.items.some((it) => it.key === a.itemKey) && <option value={a.itemKey}>{a.itemKey} ?</option>}
                              {tpl?.items.map((it) => <option key={it.key} value={it.key}>{it.label}</option>)}
                            </select>
                          </td>
                          <td style={{ textAlign: 'right' }}><input className="input" style={{ width: 110, textAlign: 'right' }} value={str(a.amount)} disabled={locked} onChange={(e) => setAlloc(i, { amount: num(e.target.value) ?? 0 })} /></td>
                          <td>{!locked && <button className="btn tertiary small" onClick={() => removeAlloc(i)}>×</button>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot><tr><td colSpan={2} style={{ textAlign: 'right' }} className="muted">{t('intake.form.sum', 'Sum')}</td><td style={{ textAlign: 'right', color: gross != null && Math.abs(sum - gross) > 0.01 ? 'var(--danger)' : undefined }}>{money(sum, inv.currency ?? 'RON')}{gross != null ? ` / ${money(gross, inv.currency ?? 'RON')}` : ''}</td><td></td></tr></tfoot>
                </table>
              )}
              {map.allocations.length === 0 && (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>{t('intake.form.fallbackHint', 'No template: the invoice is recorded on a fund, without expense lines.')}</span>
                  <select className="input" value={map.fallback?.fundCode ?? ''} disabled={locked} onChange={(e) => setMap((m) => ({ ...m, fallback: { fundCode: e.target.value || null, expenseTypeCode: m.fallback?.expenseTypeCode ?? null } }))}>
                    <option value="">{t('intake.form.fund', 'Fund')}…</option>
                    {ctx?.funds.map((f) => <option key={f.code} value={f.code}>{f.code} · {f.name}</option>)}
                  </select>
                  <select className="input" value={map.fallback?.expenseTypeCode ?? ''} disabled={locked} onChange={(e) => setMap((m) => ({ ...m, fallback: { fundCode: m.fallback?.fundCode ?? null, expenseTypeCode: e.target.value || null } }))}>
                    <option value="">{t('intake.form.expenseType', 'Expense type')}…</option>
                    {ctx?.expenseTypes.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {(hard.length > 0 || soft.length > 0) && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="label">{t('intake.drawer.blockers', 'Checks')}</div>
              {hard.map((b, i) => <BlockerRow key={`h${i}`} b={b} label={localized(blockerMeta(b.code)) || labelOf(meta?.intakeBlockers, b.code)} hint={localizedHint(blockerMeta(b.code))} />)}
              {soft.map((b, i) => (
                <label key={`s${i}`} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                  <input type="checkbox" checked={overrides.includes(b.code)} disabled={locked} onChange={() => toggle(b.code)} />
                  <span><strong>{localized(blockerMeta(b.code)) || labelOf(meta?.intakeBlockers, b.code)}</strong> — {b.message}{localizedHint(blockerMeta(b.code)) && <div className="muted" style={{ fontSize: 12 }}>{localizedHint(blockerMeta(b.code))}</div>}</span>
                </label>
              ))}
              {hard.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('intake.drawer.hardHint', 'Red checks must be fixed (in the mapping above, or in the community setup) — they cannot be acknowledged.')}</div>}
            </div>
          )}

          {isInvoice && !locked && (
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn secondary" disabled={busy} onClick={() => onSave(body())}>{t('intake.action.save', 'Save & re-check')}</button>
              <button className="btn" disabled={busy || hard.length > 0 || soft.some((b) => !overrides.includes(b.code))} onClick={() => onApprove(body())}>{t('intake.action.approve', 'Approve')}</button>
            </div>
          )}
        </div>
      </div>
    </DrawerShell>
  )
}

function Field({ label, value, onChange, disabled, placeholder }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) {
  return (
    <label className="stack" style={{ gap: 2, minWidth: 120, flex: '1 1 120px' }}>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <input className="input" value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function BlockerRow({ b, label, hint }: { b: Blocker; label: string; hint: string | null }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span className="badge negative">{label}</span> {b.message}
      {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
    </div>
  )
}
