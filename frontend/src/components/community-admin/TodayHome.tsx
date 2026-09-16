import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import type { CommunityAdminTabKey } from './CommunityAdminDashboard'
import { usePeriod } from '../../contexts/PeriodContext'
import { API_BASE } from '../../api/client'

type Props = {
  communityId: string
  /** Needed for GET /community-funds/:communityCode (keyed by code, not id) — the fund
   *  abbreviations + display order behind the "Curente"/"Restanțe" per-fund breakdown. */
  communityCode?: string
  onNavigate: (tab: CommunityAdminTabKey, extra?: Record<string, string>) => void
  /** Active role — tailors which cards/actions the home shows. Defaults to full admin. */
  viewerRole?: string
}

type StatusInfo = {
  period?: { code: string; status: string } | null
  meters?: { total: number; closed: number; open?: string[] }
  bills?: { total: number; closed: number; open?: string[] }
  canPrepare?: boolean
  canClose?: boolean
} | null

const money = (n: number | null | undefined, ccy = 'RON') =>
  n == null ? '—' : `${Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} ${ccy}`
// Bare (no currency suffix) rounded figure — used in the collapsed-card inline summary line,
// matching the reference dashboard's "Label: value" style there.
const bareNumber = (n: number | null | undefined) =>
  n == null ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 0 })
// Same explicit "MMM DD, YY" format as PeriodSelectorBar's Data Emiterii/Scadenței — deliberately
// not locale-aware (en-US regardless of app language), per that same convention.
const shortDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: '2-digit' }) : null

// Design tokens matching the reference dashboard (vicusia.lovable.app/rapoarte/dashboard) — a
// neutral, generously-rounded card system: white outer cards with a subtle border, light-grey
// nested sub-cards, uppercase tracked-out section labels, tabular-nums financial figures.
const TONE_COLOR: Record<string, string> = { warn: 'var(--danger, #ff5724)', success: 'var(--success, #22c35d)' }
const outerCardStyle: React.CSSProperties = {
  background: 'var(--bg, #fff)', border: '1px solid var(--border, #e5e5e5)', borderRadius: 16,
  padding: '18px 20px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
}
const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted, #737373)', fontWeight: 500,
}
const bigNumberStyle: React.CSSProperties = { fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 6 }
const collapseBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 999, border: '1px solid var(--border, #e5e5e5)', background: '#eceef1',
  color: 'var(--text, #1d1d1f)', cursor: 'pointer', fontSize: 16, lineHeight: 1, flexShrink: 0,
}
const MONTHS_RO_SHORT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec']
const pad2 = (n: number) => String(n).padStart(2, '0')

/** Compute the single "next action" in the monthly spine for the globally selected period. */
function nextAction(ed: StatusInfo, t: (k: string, d?: string) => string): { label: string; tab: CommunityAdminTabKey } {
  if (!ed || !ed.period) return { label: t('today.action.createPeriod', 'Start a new month'), tab: 'periodFocus' }
  const st = ed.period.status
  const metersOpen = (ed.meters?.open?.length ?? 0) > 0
  const billsOpen = (ed.bills?.open?.length ?? 0) > 0
  if (st === 'OPEN' && metersOpen) return { label: t('today.action.readings', 'Enter meter readings'), tab: 'meters' }
  if (st === 'OPEN' && billsOpen) return { label: t('today.action.invoices', 'Record invoices & expenses'), tab: 'expenses' }
  if (st === 'OPEN' && ed.canPrepare) return { label: t('today.action.prepare', 'Review & prepare the list'), tab: 'close' }
  if (st === 'PREPARED') return { label: t('today.action.close', 'Send to cenzor / close'), tab: 'close' }
  if (st === 'CLOSED') return { label: t('today.action.next', 'Start the next month'), tab: 'periodFocus' }
  return { label: t('today.action.open', 'Open the monthly close'), tab: 'close' }
}

export function TodayHome({ communityId, communityCode, onNavigate, viewerRole }: Props) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  // Fallback-aware: useI18n's t() returns the key itself when missing, so use the provided default.
  const t = (k: string, d = '') => {
    const v = rawT(k as any)
    return v && v !== k ? v : d
  }
  // The globally selected period (top bar) drives everything on this page — no separate "current
  // period" concept here anymore.
  const { selectedCode, selectedPeriod } = usePeriod()
  const [statusInfo, setStatusInfo] = React.useState<StatusInfo>(null)
  const [dash, setDash] = React.useState<any>(null)
  const [receivables, setReceivables] = React.useState<any>(null)
  const [collection, setCollection] = React.useState<any>(null)
  const [decisions, setDecisions] = React.useState<any>(null)
  const [balances, setBalances] = React.useState<any>(null)
  const [payables, setPayables] = React.useState<any>(null)
  const [communityFunds, setCommunityFunds] = React.useState<any[]>([])
  const [fundOrder, setFundOrder] = React.useState<string[]>([])
  const [vendorOrder, setVendorOrder] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(true)
  // Big cards default to collapsed, matching the reference dashboard.
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({ available: true, toCollect: true, toPay: true })
  const toggleCollapsed = (key: string) => setCollapsed((s) => ({ ...s, [key]: !s[key] }))
  // Sibling widgets within "De încasat"/"De plată" share one +/− (see Widget's expanded/
  // onToggleExpanded props) — their per-row breakdowns are aligned by fund/vendor, so opening or
  // closing any one of them opens/closes the rest.
  const [toCollectExpanded, setToCollectExpanded] = React.useState(false)
  const [toPayExpanded, setToPayExpanded] = React.useState(false)

  React.useEffect(() => {
    if (!communityId || !selectedCode) return
    let alive = true
    setLoading(true)
    const g = <T,>(url: string) => api.get<T>(url).catch(() => null)
    const period = encodeURIComponent(selectedCode)
    Promise.all([
      g<StatusInfo>(`/communities/${communityId}/periods/${period}/status`),
      g<any>(`/communities/${communityId}/dashboard`),
      g<any>(`/communities/${communityId}/finance/receivables?period=${period}`),
      g<any>(`/communities/${communityId}/finance/collection?period=${period}`),
      g<any>(`/communities/${communityId}/committee/decisions`),
      g<any>(`/communities/${communityId}/cash-accounts/balances`),
      g<any>(`/communities/${communityId}/invoices/summary?period=${period}`),
    ]).then(([ed, d, r, c, dec, bal, pay]) => {
      if (!alive) return
      setStatusInfo(ed as StatusInfo)
      setDash(d)
      setReceivables(r)
      setCollection(c)
      setDecisions(dec)
      setBalances(bal)
      setPayables(pay)
      setLoading(false)
    })
    return () => { alive = false }
  }, [communityId, selectedCode, api])

  // Fund abbreviations + admin-configured display order (from "Informații asociație" → Fonduri) —
  // period-independent, so fetched once rather than on every period change.
  React.useEffect(() => {
    if (!communityCode) return
    fetch(`${API_BASE}/community-funds/${communityCode}`)
      .then(async (res) => { if (!res.ok) throw new Error(await res.text()); return res.json() })
      .then((rows) => setCommunityFunds(Array.isArray(rows) ? rows : []))
      .catch(() => setCommunityFunds([]))
  }, [communityCode])
  React.useEffect(() => {
    if (!communityId) return
    api.get<any>(`/communities/${communityId}/association-info`)
      .then((info: any) => {
        setFundOrder(Array.isArray(info?.fundConfig?.order) ? info.fundConfig.order : [])
        setVendorOrder(Array.isArray(info?.vendorConfig?.order) ? info.vendorConfig.order : [])
      })
      .catch(() => { setFundOrder([]); setVendorOrder([]) })
  }, [communityId, api])

  if (loading) return <div className="empty">{t('common.loading', 'Loading…')}</div>

  const st = statusInfo?.period?.status

  const isAdmin = !viewerRole || viewerRole === 'COMMUNITY_ADMIN'
  const isCensor = viewerRole === 'CENSOR'
  const isCommittee = viewerRole === 'EXECUTIVE_COMITEE_MEMBER'
  const decList: any[] = decisions?.decisions ?? []
  const pendingForMe = decList.filter((d) => d.status === 'OPEN' && !d.myVote).length

  // The single "next step" for the selected period, tailored by role — surfaced as the first
  // "De făcut" row rather than a standalone banner.
  const action: { label: string; tab: CommunityAdminTabKey } = isCensor
    ? { label: st === 'PREPARED' ? t('today.action.signoff', 'Semnează avizierul') : t('today.action.viewAvizier', 'Vezi avizierul'), tab: 'avizier' }
    : isCommittee
      ? { label: pendingForMe > 0 ? `${t('today.action.vote', 'Votează deciziile')} (${pendingForMe})` : t('today.action.viewDecisions', 'Vezi deciziile'), tab: 'decisions' }
      : nextAction(statusInfo, t)

  const periodTaskLabel = statusInfo?.period?.code ? `${action.label} (${statusInfo.period.code})` : action.label
  const taskRows: Array<{ label: string; onClick?: () => void }> = [
    { label: periodTaskLabel, onClick: () => onNavigate(action.tab) },
    ...((dash?.tasks ?? []).map((x: any) => ({ label: x.title, onClick: () => onNavigate('inventory') }))),
  ]

  const eventRows = (dash?.upcomingEvents ?? []).map((x: any) => {
    const start: Date | null = x.startAt ? new Date(x.startAt) : null
    const end: Date | null = x.endAt ? new Date(x.endAt) : null
    // Day is essential here — month+year alone made every event in the same month look identical.
    const dateStr = start ? `${start.getDate()} ${MONTHS_RO_SHORT[start.getMonth()]}` : ''
    const timeStr = start ? `${pad2(start.getHours())}:${pad2(start.getMinutes())}` : ''
    const durH = start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 3600000)) : null
    const sub = start ? `${dateStr} · ${timeStr}${durH != null ? ` (${durH}h)` : ''}` : undefined
    return { label: x.title, sub }
  })
  const requestRows = (dash?.requests ?? []).slice(0, 3).map((x: any) => ({ label: x.title }))
  const requestsTotal: number = dash?.requestsTotal ?? (dash?.requests ?? []).length

  // Grad de încasare pe lună = Încasări / (De încasat: Curente + Restanțe) — not the backend's
  // collection.ratePct, which is Încasări/Curente only (ignores outstanding Restanțe).
  const toCollectTotal = (collection?.charged ?? 0) + (receivables?.totalDebt ?? 0)
  const collectionRatePct = toCollectTotal > 0 ? ((collection?.collected ?? 0) / toCollectTotal) * 100 : null
  // Grad de plată pe lună = Plăți / (De plată: Facturi curente + Facturi restante).
  const toPayTotal = (payables?.currentGross ?? 0) + (payables?.overdueOutstanding ?? 0)
  const paymentRatePct = toPayTotal > 0 ? ((payables?.paidThisMonth ?? 0) / toPayTotal) * 100 : null

  // Fund abbreviation per code (falls back to the short name, then the fund's own name, then the
  // raw code), and a shared display order for the "De încasat" Curente/Restanțe per-fund
  // breakdown: the union of funds appearing in either widget, in the configurator's order, so a
  // fund missing from one shows as a blank line there instead of shifting the other's rows out of
  // alignment. The "De plată" side does the same thing but grouped by vendor (see byVendor on the
  // backend) — one shared legend across Curente/Restanțe/Plăți, ordered by vendorConfig.order.
  const orderedUnion = (order: string[], ...lists: Array<Array<{ fundCode: string }>> | Array<Array<{ fundCode: string }> | undefined>) => {
    const codes = new Set<string>()
    for (const list of lists) for (const f of list ?? []) codes.add(f.fundCode)
    const rank = new Map(order.map((c, i) => [c, i]))
    return Array.from(codes).sort((a, b) => (rank.has(a) ? rank.get(a)! : Infinity) - (rank.has(b) ? rank.get(b)! : Infinity))
  }
  const fundLabelOf = (code: string) => {
    const f = communityFunds.find((x) => x.code === code)
    return f?.allocation?.abbrev || f?.allocation?.shortName || f?.name || code
  }
  const byVendorRows = (list: Array<{ vendorId: string; vendorName?: string | null; amount: number }> | undefined) =>
    list?.map((v) => ({ fundCode: v.vendorId, fundName: v.vendorName, amount: v.amount }))
  const collectFundLegend = orderedUnion(fundOrder, collection?.chargedByFund, receivables?.byFund)
  const payVendorLegend = orderedUnion(
    vendorOrder,
    byVendorRows(payables?.currentByVendor), byVendorRows(payables?.overdueByVendor), byVendorRows(payables?.paidByVendor),
  )
  const vendorNameById = new Map<string, string>()
  for (const list of [payables?.currentByVendor, payables?.overdueByVendor, payables?.paidByVendor]) {
    for (const v of list ?? []) if (v.vendorName) vendorNameById.set(v.vendorId, v.vendorName)
  }
  const vendorLabelOf = (id: string) => vendorNameById.get(id) || id

  const balanceOf = (type: 'BANK' | 'PETTY', currency: string) =>
    balances?.totals?.find((x: any) => x.type === type && x.currency === currency)?.balance ?? null
  const accountIdsOf = (type: 'BANK' | 'PETTY', currency: string) =>
    (balances?.accounts ?? []).filter((a: any) => a.type === type && a.currency === currency).map((a: any) => a.id).join(',')
  const eurAccount = balances?.accounts?.find((a: any) => a.type === 'BANK' && a.currency === 'EUR')
  // RON bank, EUR bank, and petty cash each keep their own register, so their last-updated date
  // can differ — unlike totalRon/balanceOf, this is never combined across accounts of the same
  // type+currency without picking the most recent one.
  const lastActivityOf = (type: 'BANK' | 'PETTY', currency: string) =>
    (balances?.accounts ?? [])
      .filter((a: any) => a.type === type && a.currency === currency && a.lastActivityDate)
      .map((a: any) => a.lastActivityDate)
      .sort()
      .pop() ?? null
  const openRegister = (accountIds: string) => onNavigate('cashRegister', accountIds.includes(',') ? { accounts: accountIds } : { account: accountIds })

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{t('today.dashboardTitle', 'Dashboard Asociație')}</h1>
        <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
          {t('today.dashboardSubtitle', 'Imagine financiară de ansamblu')} {t('today.dashboardFor', 'pentru')} {selectedCode}
          {balances?.lastActivityDate ? `, ${t('today.dashboardAsOf', 'la')} ${shortDate(balances.lastActivityDate)} (${t('today.lastBankStatement', 'ultimul extras bancar')})` : ''}.
        </p>
      </div>

      {/* Money widgets (finance reads — visible to all roles that reach this home), in order:
          1. Disponibil — bank/cash balances, combined RON-equivalent total up top.
          2. De Încasat — resident-side current charges, arrears, collections.
          3. De Plată — vendor-side current invoices, arrears, payments this month.
          Each wraps its 3 components in one collapsible card headed by their combined total. */}
      <SummaryCard sectionKey="available" title={t('today.available', 'Disponibil')} main={money(balances?.totalRon)}
        italic
        collapsed={collapsed} onToggle={toggleCollapsed}
        summaryItems={[
          { label: t('today.bankRon', 'Sold Bancă (RON)'), value: bareNumber(balanceOf('BANK', 'RON')) },
          { label: t('today.bankEur', 'Sold Bancă (EUR)'), value: bareNumber(eurAccount?.ronEquivalent) },
          { label: t('today.cashRon', 'Sold Numerar (RON)'), value: bareNumber(balanceOf('PETTY', 'RON')) },
        ]}>
        <Widget title={t('today.bankRon', 'Sold Bancă (RON)')} onClick={() => openRegister(accountIdsOf('BANK', 'RON'))}
          main={money(balanceOf('BANK', 'RON'), 'RON')}
          sub={lastActivityOf('BANK', 'RON') ? `${t('today.lastActivity', 'Extras')}: ${shortDate(lastActivityOf('BANK', 'RON'))}` : undefined} />
        <Widget title={t('today.bankEur', 'Sold Bancă (EUR)')} onClick={() => eurAccount && openRegister(eurAccount.id)}
          main={money(eurAccount?.ronEquivalent, 'RON')}
          sub={[
            eurAccount ? `${money(eurAccount.balance, 'EUR')}${eurAccount.fxRateEstimate != null ? ` · ${t('today.fxRateLabel', 'curs')} ${Number(eurAccount.fxRateEstimate).toFixed(4)}` : ''}` : null,
            eurAccount?.lastActivityDate ? `${t('today.lastActivity', 'Extras')}: ${shortDate(eurAccount.lastActivityDate)}` : null,
          ].filter(Boolean).join(' · ') || undefined} />
        <Widget title={t('today.cashRon', 'Sold Numerar (RON)')} onClick={() => openRegister(accountIdsOf('PETTY', 'RON'))}
          main={money(balanceOf('PETTY', 'RON'), 'RON')}
          sub={lastActivityOf('PETTY', 'RON') ? `${t('today.lastActivity', 'Extras')}: ${shortDate(lastActivityOf('PETTY', 'RON'))}` : undefined} />
      </SummaryCard>

      <SummaryCard sectionKey="toCollect" title={t('today.toCollect', 'De încasat (Venituri) / Încasări')} main={money(toCollectTotal)}
        sub={`${t('today.collectionRateShort', 'Grad de încasare')}: ${collectionRatePct == null ? '—' : `${collectionRatePct.toFixed(2)}%`}`}
        collapsed={collapsed} onToggle={toggleCollapsed}
        summaryItems={[
          { label: t('today.current', 'Curente'), value: bareNumber(collection?.charged) },
          { label: t('today.debtors', 'Restanțe'), value: bareNumber(receivables?.totalDebt), tone: 'warn' },
          { label: t('today.receipts', 'Încasări'), value: bareNumber(collection?.collected), tone: 'success' },
        ]}>
        <Widget title={t('today.current', 'Curente')} onClick={() => onNavigate('avizier')} byFund={collection?.chargedByFund}
          fundOrder={collectFundLegend} fundLabelOf={fundLabelOf}
          expanded={toCollectExpanded} onToggleExpanded={() => setToCollectExpanded((v) => !v)}
          main={money(collection?.charged)}
          sub={[shortDate(selectedPeriod?.afisareDate), `${collection?.chargedCount ?? 0} ${t('today.units', 'units')}`].filter(Boolean).join(' · ')} />
        <Widget title={t('today.debtors', 'Restanțe')} onClick={() => onNavigate('debtors')} byFund={receivables?.byFund}
          fundOrder={collectFundLegend} fundLabelOf={fundLabelOf}
          expanded={toCollectExpanded} onToggleExpanded={() => setToCollectExpanded((v) => !v)}
          main={money(receivables?.totalDebt)}
          sub={[shortDate(selectedPeriod?.afisareDate), `${receivables?.debtorCount ?? 0} ${t('today.units', 'units')}`].filter(Boolean).join(' · ')} tone="warn" />
        <Widget title={t('today.receipts', 'Încasări')} onClick={() => selectedCode && onNavigate('cashRegister', { scope: 'receipts', period: selectedCode })}
          main={money(collection?.collected)}
          sub={[
            balances?.lastActivityDate ? `${t('today.lastActivity', 'Extras')}: ${shortDate(balances.lastActivityDate)}` : null,
            `${collection?.collectedCount ?? 0} ${t('today.units', 'units')}`,
          ].filter(Boolean).join(' · ')} tone="success" italic />
      </SummaryCard>

      <SummaryCard sectionKey="toPay" title={t('today.toPay', 'De plată (Cheltuieli) / Plăți')} main={money(toPayTotal)}
        sub={`${t('today.paymentRateShort', 'Grad de plată')}: ${paymentRatePct == null ? '—' : `${paymentRatePct.toFixed(2)}%`}`}
        collapsed={collapsed} onToggle={toggleCollapsed}
        summaryItems={[
          { label: t('today.payCurrent', 'Curente'), value: bareNumber(payables?.currentGross) },
          { label: t('today.payOverdue', 'Restanțe'), value: bareNumber(payables?.overdueOutstanding), tone: 'warn' },
          { label: t('today.payPaid', 'Plăți'), value: bareNumber(payables?.paidThisMonth), tone: 'success' },
        ]}>
        <Widget title={t('today.payCurrent', 'Curente')} onClick={() => selectedCode && onNavigate('payments', { period: selectedCode, filter: 'current' })}
          main={money(payables?.currentGross)}
          sub={[shortDate(selectedPeriod?.afisareDate), `${payables?.currentVendorCount ?? 0} ${t('today.vendorsLabel', 'furnizori')}`].filter(Boolean).join(' · ')}
          byFund={byVendorRows(payables?.currentByVendor)} fundOrder={payVendorLegend} fundLabelOf={vendorLabelOf}
          expanded={toPayExpanded} onToggleExpanded={() => setToPayExpanded((v) => !v)} />
        <Widget title={t('today.payOverdue', 'Restanțe')} onClick={() => selectedCode && onNavigate('payments', { period: selectedCode, filter: 'overdue' })}
          main={money(payables?.overdueOutstanding)}
          sub={[shortDate(selectedPeriod?.afisareDate), `${payables?.overdueVendorCount ?? 0} ${t('today.vendorsLabel', 'furnizori')}`].filter(Boolean).join(' · ')} tone="warn"
          byFund={byVendorRows(payables?.overdueByVendor)} fundOrder={payVendorLegend} fundLabelOf={vendorLabelOf}
          expanded={toPayExpanded} onToggleExpanded={() => setToPayExpanded((v) => !v)} />
        <Widget title={t('today.payPaid', 'Plăți')} onClick={() => selectedCode && onNavigate('payments', { period: selectedCode, filter: 'paid' })}
          main={money(payables?.paidThisMonth)}
          expanded={toPayExpanded} onToggleExpanded={() => setToPayExpanded((v) => !v)}
          sub={[
            balances?.lastActivityDate ? `${t('today.lastActivity', 'Extras')}: ${shortDate(balances.lastActivityDate)}` : null,
            `${payables?.paidVendorCount ?? 0} ${t('today.vendorsLabel', 'furnizori')}`,
          ].filter(Boolean).join(' · ')} tone="success" italic
          byFund={byVendorRows(payables?.paidByVendor)} fundOrder={payVendorLegend} fundLabelOf={vendorLabelOf} />
      </SummaryCard>

      {/* De făcut / Evenimente viitoare / Solicitări (admin + committee — cenzor is finance-only) */}
      {(isAdmin || isCommittee) && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <ListCard title={t('today.tasksTitle', 'De făcut')} rows={taskRows} onOpen={() => onNavigate('inventory')} empty={t('today.noTasks', 'No open tasks')} count={taskRows.length} />
          <ListCard title={t('today.eventsTitle', 'Evenimente viitoare')} rows={eventRows} onOpen={() => onNavigate('events')} empty={t('today.noEvents', 'No upcoming events')} count={eventRows.length} />
          <ListCard title={t('today.requestsTitle', 'Solicitări')} rows={requestRows} count={requestsTotal} badgeTone="warn" onOpen={() => onNavigate('requests')} empty={t('today.noRequests', 'Nicio solicitare')} />
        </div>
      )}
    </div>
  )
}

function SummaryCard({
  sectionKey, title, main, sub, collapsed, onToggle, summaryItems, italic, children,
}: {
  sectionKey: string
  title: string
  main: string
  sub?: string
  collapsed: Record<string, boolean>
  onToggle: (key: string) => void
  summaryItems: Array<{ label: string; value: string; tone?: string }>
  /** This card's figures are cash (numerar), not accrual — styled in italic to tell them apart. */
  italic?: boolean
  children: React.ReactNode
}) {
  const isCollapsed = !!collapsed[sectionKey]
  return (
    <div style={{ ...outerCardStyle, fontStyle: italic ? 'italic' : undefined }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={sectionLabelStyle}>{title}</div>
          <div style={{ ...bigNumberStyle, fontVariantNumeric: 'tabular-nums' }}>{main}</div>
          {sub ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div> : null}
          {isCollapsed && (
            <div className="row" style={{ fontSize: 12, marginTop: 4, gap: 16, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
              {summaryItems.map((it) => (
                <span key={it.label}>
                  <span className="muted">{it.label}: </span>
                  <span style={{ color: it.tone ? TONE_COLOR[it.tone] : undefined }}>{it.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <button type="button" style={collapseBtnStyle} onClick={() => onToggle(sectionKey)}
          title={isCollapsed ? 'Extinde' : 'Restrânge'} aria-label={isCollapsed ? 'Extinde' : 'Restrânge'}>
          {isCollapsed ? '+' : '−'}
        </button>
      </div>
      {/* Kept mounted-but-hidden (not unmounted) when collapsed, so state inside the inner
          widgets survives collapse/expand — this is a pure visibility toggle. */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16, display: isCollapsed ? 'none' : 'grid' }}>
        {children}
      </div>
    </div>
  )
}

function Widget({
  title, main, sub, onClick, byFund, fundOrder, fundLabelOf, tone, italic, expanded: expandedProp, onToggleExpanded,
}: {
  title: string; main: string; sub?: string; onClick?: () => void
  /** Per-fund (or, for "Plăți", per-vendor) breakdown — when given, the card gets its own +/−
   * expand toggle (independent of the outer big card's own collapse), matching the reference
   * dashboard's behavior. `fundCode` is just the row's grouping key; `fundName`, when set, is
   * used as the label whenever `fundLabelOf` isn't given. */
  byFund?: Array<{ fundCode: string; fundName?: string | null; amount: number }>
  /** Display order shared with a sibling widget (e.g. Curente/Restanțe on the same card) — the
   * union of both widgets' fund codes, in the configurator's order. When given, every code in it
   * gets a row (blank amount if this widget's own byFund lacks that fund), so the same fund lands
   * on the same line across both cards instead of each widget compacting to its own subset. */
  fundOrder?: string[]
  fundLabelOf?: (code: string) => string
  tone?: string; italic?: boolean
  /** Controlled expand state — when given (with onToggleExpanded), sibling widgets in the same
   * group share one +/− so opening/closing any one of them opens/closes them all, keeping their
   * aligned per-row breakdowns visible together. Falls back to independent internal state when
   * omitted (e.g. widgets with no shared legend). */
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  const [internalExpanded, setInternalExpanded] = React.useState(false)
  const expanded = expandedProp ?? internalExpanded
  const toggleExpanded = onToggleExpanded ?? (() => setInternalExpanded((v) => !v))
  const fundRows = (fundOrder && fundOrder.length > 0 ? fundOrder : (byFund ?? []).map((f) => f.fundCode)).map((code) => {
    const entry = byFund?.find((f) => f.fundCode === code)
    return { code, label: fundLabelOf ? fundLabelOf(code) : entry?.fundName || code, amount: entry?.amount ?? null }
  })
  return (
    <div
      onClick={onClick}
      style={{
        background: '#eceef1', border: '1px solid var(--border, #e5e5e5)', borderRadius: 12, padding: 14,
        display: 'flex', flexDirection: 'column', gap: 4, cursor: onClick ? 'pointer' : 'default',
        fontStyle: italic ? 'italic' : undefined,
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>{title}</span>
        {fundRows.length > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded() }}
            title={expanded ? 'Restrânge' : 'Extinde'} aria-label={expanded ? 'Restrânge' : 'Extinde'}
            style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: 'none', color: 'var(--accent, #0071e3)', cursor: 'pointer', fontSize: 14, lineHeight: 1, flexShrink: 0 }}>
            {expanded ? '−' : '+'}
          </button>
        )}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: tone ? TONE_COLOR[tone] : undefined }}>{main}</div>
      {sub ? <div className="muted" style={{ fontSize: 12 }}>{sub}</div> : null}
      {expanded && fundRows.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border, #e5e5e5)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {fundRows.map((f) => (
            <div key={f.code} className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">{f.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{f.amount == null ? '' : bareNumber(f.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const listBadgeStyle = (warn: boolean): React.CSSProperties => ({
  minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999,
  background: warn ? 'rgba(255,87,36,0.12)' : '#eceef1',
  color: warn ? 'var(--danger, #ff5724)' : 'var(--muted, #6e6e73)',
  fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
})

// Elegant/minimalist list card (Apple-style): no bullets, no "Open" button — the whole card is the
// tap target, and the header count reads as a plain badge instead of a call-to-action.
function ListCard({ title, rows, onOpen, empty, count, badgeTone }: {
  title: string
  rows: Array<{ label: string; sub?: string; onClick?: () => void }>
  onOpen: () => void
  empty: string
  count: number
  badgeTone?: 'warn'
}) {
  return (
    <div style={{ ...outerCardStyle, padding: 18, cursor: 'pointer' }} onClick={onOpen}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>
        <span style={listBadgeStyle(badgeTone === 'warn' && count > 0)}>{count}</span>
      </div>
      {rows.length ? (
        <div className="stack" style={{ gap: 10, marginTop: 14 }}>
          {rows.slice(0, 4).map((r, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}
              onClick={r.onClick ? (e) => { e.stopPropagation(); r.onClick!() } : undefined}>
              <span style={{ fontSize: 13, color: 'var(--text, #1d1d1f)', cursor: r.onClick ? 'pointer' : 'inherit' }}>{r.label}</span>
              {r.sub ? <span className="muted" style={{ fontSize: 11, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{r.sub}</span> : null}
            </div>
          ))}
        </div>
      ) : <div className="muted" style={{ marginTop: 14, fontSize: 13 }}>{empty}</div>}
    </div>
  )
}
