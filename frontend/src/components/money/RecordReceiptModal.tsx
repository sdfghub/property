import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { DrawerShell } from './DrawerShell'
import { CashAccountSelect } from './CashAccountSelect'
import { FundSelect } from './FundSelect'
import { ReceiptPrintView, ReceiptData } from './ReceiptPrintView'
import { money, num2, simulateFifo } from './money-utils'

type BE = { id: string; code?: string; name?: string }

export function RecordReceiptModal({
  communityId,
  communityCode,
  communityName,
  billingEntities,
  preselectBeId,
  open,
  onClose,
  onDone,
}: {
  communityId: string
  communityCode: string
  communityName?: string
  billingEntities: BE[]
  preselectBeId?: string
  open: boolean
  onClose: () => void
  onDone: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const today = new Date().toISOString().slice(0, 10)
  const [beId, setBeId] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [currency] = React.useState('RON')
  const [ts, setTs] = React.useState(today)
  const [method, setMethod] = React.useState('')
  const [refId, setRefId] = React.useState('')
  const [accountId, setAccountId] = React.useState('')
  const [accountName, setAccountName] = React.useState('')
  const [mode, setMode] = React.useState<'fifo' | 'select' | 'avans'>('fifo')
  const [picked, setPicked] = React.useState<Set<string>>(new Set()) // selected chargeIds (backend settles FIFO within)
  const [creditFundId, setCreditFundId] = React.useState('')
  const [creditFundName, setCreditFundName] = React.useState('')
  const [openCharges, setOpenCharges] = React.useState<any>(null)
  const [loadingCharges, setLoadingCharges] = React.useState(false)
  const [fundMap, setFundMap] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<{ applied: number; remaining: number } | null>(null)
  const [receipt, setReceipt] = React.useState<ReceiptData | null>(null)

  React.useEffect(() => { if (open && preselectBeId) setBeId(preselectBeId) }, [open, preselectBeId])

  // best-effort fund id → name for the settlement preview labels
  React.useEffect(() => {
    if (!open || !communityCode) return
    api.get<any[]>(`/community-funds/${communityCode}`).then((rows) => {
      const m: Record<string, string> = {}
      ;(rows || []).forEach((f: any) => { if (f?.id) m[f.id] = f.name || f.code || 'Fond' })
      setFundMap(m)
    }).catch(() => {})
  }, [api, open, communityCode])

  React.useEffect(() => {
    if (!beId) { setOpenCharges(null); return }
    let alive = true
    setLoadingCharges(true)
    api.get<any>(`/communities/${communityId}/payments/open-charges?billingEntityId=${encodeURIComponent(beId)}`)
      .then((d) => { if (alive) setOpenCharges(d) })
      .catch(() => { if (alive) setOpenCharges(null) })
      .finally(() => { if (alive) setLoadingCharges(false) })
    return () => { alive = false }
  }, [api, communityId, beId])

  const totalAvailable = num2(openCharges?.totalAvailable)
  const items: any[] = openCharges?.items || []
  const be = billingEntities.find((b) => b.id === beId)
  const chargeLabel = (it: any) => [it.fundName || fundMap[it.fundId] || t('receipt.charge', 'Taxă'), it.periodCode].filter(Boolean).join(' · ')

  // The entered amount is what's received; selection only restricts which charges it settles.
  const amt = num2(amount)
  const selectedItems = items.filter((it) => picked.has(it.chargeId))
  const selectedAvailable = num2(selectedItems.reduce((s, it) => s + num2(it.available), 0))
  // live preview: how the amount settles the relevant charges (FIFO), backend does the same
  const preview = mode === 'fifo' ? simulateFifo(items, amt) : mode === 'select' ? simulateFifo(selectedItems, amt) : []
  const settledTotal = num2(preview.reduce((s, p) => s + p.settled, 0))
  const overpayFifo = mode === 'fifo' && amt > totalAvailable + 0.005
  const advanceAmt = mode === 'avans'
    ? amt
    : mode === 'fifo'
      ? (overpayFifo ? num2(amt - totalAvailable) : 0)
      : mode === 'select'
        ? Math.max(0, num2(amt - selectedAvailable))
        : 0
  const needCreditFund = advanceAmt > 0.005

  const filtered = billingEntities.filter((b) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (b.name || '').toLowerCase().includes(q) || (b.code || '').toLowerCase().includes(q)
  })

  function reset() {
    setBeId(''); setQuery(''); setAmount(''); setTs(today); setMethod(''); setRefId('')
    setMode('fifo'); setPicked(new Set()); setCreditFundId(''); setCreditFundName(''); setOpenCharges(null); setError(null); setSuccess(null); setReceipt(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!beId || !amt) return
    if (mode === 'select' && picked.size === 0) { setError(t('receipt.needCharges', 'Alegeți cel puțin o taxă.')); return }
    if (!accountId) { setError(t('receipt.needAccount', 'Alegeți un cont / casierie.')); return }
    if (needCreditFund && !creditFundId) { setError(t('receipt.needCreditFund', 'Alegeți fondul pentru avans.')); return }
    setSubmitting(true); setError(null)
    try {
      let allocationSpec: any[] | undefined
      if (mode === 'select') {
        // markers = which charges to settle; backend applies the amount FIFO within them
        allocationSpec = [
          ...selectedItems.map((it) => ({ chargeId: it.chargeId })),
          ...(advanceAmt > 0 ? [{ advance: true, fundId: creditFundId }] : []),
        ]
      } else if (mode === 'avans') {
        allocationSpec = [{ advance: true, fundId: creditFundId, amount: amt }]
      } else if (overpayFifo) {
        // FIFO settles what's owed; the excess is credited as an advance to the chosen fund
        allocationSpec = [{ advance: true, fundId: creditFundId }]
      }
      const res = await api.post<any>(`/communities/${communityId}/payments`, {
        billingEntityId: beId,
        amount: amt,
        currency,
        ts: ts || undefined,
        method: method || undefined,
        refId: refId || undefined,
        accountId: accountId || undefined,
        allocationSpec,
      })
      const applied = num2(res?.applied ?? (mode === 'avans' ? 0 : mode === 'select' ? Math.min(amt, selectedAvailable) : Math.min(amt, totalAvailable)))
      const advance = num2(res?.advance ?? advanceAmt)
      setSuccess({ applied, remaining: advance })
      const settledLines = mode === 'avans'
        ? []
        : preview.map((p) => ({ label: chargeLabel(p), amount: p.settled }))
      const receiptLines = advance > 0
        ? [...settledLines, { label: `${t('receipt.advance', 'Avans')} · ${creditFundName}`, amount: advance }]
        : settledLines
      setReceipt({
        kind: 'IN',
        number: res?.payment?.refId || res?.payment?.id || refId || '—',
        date: ts || today,
        party: be?.name || be?.code || beId,
        amount: amt,
        currency,
        method: method || undefined,
        accountName: accountName || undefined,
        communityName,
        lines: receiptLines,
      })
      onDone()
    } catch (err: any) {
      const msg = err?.message || ''
      if (/exceeds open charges/i.test(msg)) {
        setError(t('receipt.exceeds', 'Suma depășește datoria deschisă.') + ` (${money(totalAvailable, currency)})`)
      } else {
        setError(msg || t('common.error', 'Eroare'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <DrawerShell open={open} onClose={() => { reset(); onClose() }} title={t('money.recordReceipt', 'Încasare')}>
      {success ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="badge positive" style={{ alignSelf: 'flex-start' }}>
            {t('receipt.success', 'Încasare înregistrată')}
          </div>
          <div className="card soft">
            <div>{t('receipt.recorded', 'Încasat')}: <strong>{money(success.applied, currency)}</strong></div>
            {success.remaining > 0.005 && (
              <div className="muted">{t('receipt.advance', 'Avans')}: {money(success.remaining, currency)}</div>
            )}
          </div>
          {receipt && <ReceiptPrintView data={receipt} />}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn primary small" type="button" onClick={reset}>{t('receipt.new', 'Încasare nouă')}</button>
            <button className="btn ghost small" type="button" onClick={() => { reset(); onClose() }}>{t('common.close', 'Închide')}</button>
          </div>
        </div>
      ) : (
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <div className="stack" style={{ gap: 6 }}>
            <label className="label">{t('receipt.entity', 'Apartament / entitate')}</label>
            <input className="input" placeholder={t('receipt.search', 'Caută…')} value={query} onChange={(e) => setQuery(e.target.value)} />
            <select className="input" value={beId} onChange={(e) => setBeId(e.target.value)}>
              <option value="">{t('payments.selectBe', 'Selectează')}</option>
              {filtered.map((b) => <option key={b.id} value={b.id}>{b.name || b.code}</option>)}
            </select>
            {beId && (
              <div className="muted">
                {loadingCharges ? t('common.loading', 'Loading…') : `${t('receipt.owes', 'Datorează')}: ${money(totalAvailable, currency)}`}
              </div>
            )}
          </div>

          {beId && (
            <div className="stack" style={{ gap: 6 }}>
              <label className="label">{t('receipt.mode', 'Cum se sting taxele')}</label>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {([['fifo', t('receipt.modeFifo', 'Automat (regula comunității)')], ['select', t('receipt.modeSelect', 'Alege taxele')], ['avans', t('receipt.modeAvans', 'Avans (credit)')]] as const).map(([m, lbl]) => (
                  <button key={m} type="button" className={`btn small ${mode === m ? 'primary' : 'ghost'}`} onClick={() => setMode(m as any)}>{lbl}</button>
                ))}
              </div>
            </div>
          )}

          <div className="stack" style={{ gap: 6 }}>
            <label className="label">{t('receipt.received', 'Sumă încasată')}</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" type="number" step="0.01" style={{ width: 140 }} value={amount}
                onChange={(e) => setAmount(e.target.value)} required />
              {mode !== 'avans' && (
                <button type="button" className="btn ghost small"
                  disabled={mode === 'select' ? !selectedAvailable : !totalAvailable}
                  onClick={() => setAmount(String(mode === 'select' ? selectedAvailable : totalAvailable))}>
                  {t('receipt.payFull', 'Achită tot')}
                </button>
              )}
            </div>
          </div>

          {mode === 'select' && (
            <div className="stack" style={{ gap: 6 }}>
              <label className="label">{t('receipt.pickCharges', 'Taxe de stins')}</label>
              {loadingCharges ? <div className="muted">{t('common.loading', 'Loading…')}</div> : !items.length ? (
                <div className="empty">{t('receipt.noCharges', 'Nicio taxă deschisă.')}</div>
              ) : (
                <div className="card soft" style={{ padding: 8 }}>
                  {items.map((it) => (
                    <label key={it.chargeId} className="row" style={{ gap: 8, alignItems: 'center', padding: '3px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={picked.has(it.chargeId)}
                        onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(it.chargeId); else n.delete(it.chargeId); return n })} />
                      <span style={{ flex: 1 }}>{chargeLabel(it)}</span>
                      <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(it.available, currency)}</span>
                    </label>
                  ))}
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 6, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
                    <span className="muted">{t('receipt.selectedAvailable', 'Disponibil selectat')}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(selectedAvailable, currency)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {t('receipt.selectHint', 'Suma se distribuie FIFO pe taxele bifate; surplusul devine avans.')}
                  </div>
                </div>
              )}
            </div>
          )}

          {needCreditFund && (
            <div className="stack" style={{ gap: 6 }}>
              <FundSelect communityCode={communityCode} value={creditFundId}
                label={t('receipt.creditFund', 'Fondul pentru avans (credit)')}
                placeholder={t('fund.select', 'Selectează fondul')}
                onChange={(id, f) => { setCreditFundId(id); setCreditFundName(f?.name || '') }} />
              {advanceAmt > 0 && (
                <div className="badge secondary" style={{ alignSelf: 'flex-start' }}>
                  {t('receipt.advanceWillCredit', 'Avans înregistrat')}: {money(advanceAmt, currency)}
                </div>
              )}
            </div>
          )}

          <CashAccountSelect communityId={communityId} value={accountId}
            onChange={(id, acc) => { setAccountId(id); setAccountName(acc?.name || '') }} />

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 4 }}>
              <label className="label">{t('receipt.date', 'Data')}</label>
              <input className="input" type="date" value={ts} onChange={(e) => setTs(e.target.value)} />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="label">{t('receipt.method', 'Metodă')}</label>
              <input className="input" style={{ width: 130 }} placeholder="cash / transfer" value={method} onChange={(e) => setMethod(e.target.value)} />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <label className="label">{t('receipt.ref', 'Referință')}</label>
              <input className="input" style={{ width: 130 }} value={refId} onChange={(e) => setRefId(e.target.value)} />
            </div>
          </div>

          {(mode === 'fifo' || mode === 'select') && beId && amt > 0 && (
            <div className="card soft">
              <div className="muted" style={{ marginBottom: 4 }}>{t('receipt.willSettle', 'Se vor stinge')}:</div>
              {preview.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {preview.map((p, i) => (
                    <li key={i} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {chargeLabel(p)}: {money(p.settled, currency)}
                    </li>
                  ))}
                </ul>
              ) : <div className="muted">{t('receipt.nothing', '—')}</div>}
              <div className="row" style={{ justifyContent: 'flex-end', fontWeight: 700, marginTop: 4 }}>
                {money(settledTotal, currency)}
              </div>
            </div>
          )}

          {advanceAmt > 0 && mode !== 'avans' && (
            <div className="badge secondary">
              {t('receipt.overpayInfo', 'Suma depășește datoria; diferența se înregistrează ca avans pe fondul ales.')}
            </div>
          )}
          {error && <div className="badge negative">{error}</div>}

          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="submit" disabled={submitting || !beId || !amt}>
              {submitting ? t('common.loading', '…') : t('common.confirm', 'Înregistrează')}
            </button>
          </div>
        </form>
      )}
    </DrawerShell>
  )
}
