import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { BillForm, BillTemplate } from './BillForm'
import { AttachmentPane } from '../TemplateAttachments'

const TOTAL_TAB = '__TOTAL__'

type Group = { vendor: string; templates: BillTemplate[]; minOrder: number }

/** Bill templates sharing the same vendor (template.output.vendor.name) collapse into one tab —
 *  a single invoice (e.g. Aquatim's) routinely covers several templates (apă rece + apă meteo),
 *  so entering it once should fill everything it covers, not force the admin to hunt down a
 *  second tab for the same piece of paper. Falls back to the template's own name/code when no
 *  vendor is set, so nothing silently disappears. */
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
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [templates, setTemplates] = React.useState<BillTemplate[]>([])
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeVendor, setActiveVendor] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    setActiveVendor(null)
    setRefreshKey((k) => k + 1)
  }, [communityId, periodCode])

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    setMessage(null)
    api
      .get<BillTemplate[]>(`/communities/${communityId}/periods/${periodCode}/bill-templates`)
      .then((rows) => {
        setTemplates(rows || [])
        const closed = (rows || []).filter((r: any) => (r as any).state === 'CLOSED').length
        onStatusChange?.({ total: rows?.length || 0, closed })
      })
      .catch((err: any) => setMessage(err?.message || 'Failed to load bill templates'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, communityId, periodCode, refreshKey])

  if (message) return <div className="badge negative">{message}</div>

  const vendorOf = (tpl: any): string => tpl?.template?.output?.vendor?.name || tpl?.name || tpl?.code || 'Furnizor'

  const groups: Group[] = React.useMemo(() => {
    const map = new Map<string, BillTemplate[]>()
    for (const tpl of templates) {
      const vendor = vendorOf(tpl)
      if (!map.has(vendor)) map.set(vendor, [])
      map.get(vendor)!.push(tpl)
    }
    return Array.from(map.entries())
      .map(([vendor, tpls]) => ({ vendor, templates: tpls, minOrder: Math.min(...tpls.map((t: any) => t.order ?? 0)) }))
      .sort((a, b) => a.minOrder - b.minOrder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates])

  const active = activeVendor === TOTAL_TAB ? undefined : (groups.find((g) => g.vendor === activeVendor) || groups[0])
  const activeTemplates = (active?.templates || []).map((tpl: any) => ({
    ...(tpl.template || tpl),
    code: tpl.code || (tpl.template || tpl).code,
    state: tpl.state || (tpl.template || tpl).state,
  }))

  // Same current/arrears split BillForm uses per vendor group, reused here to roll every
  // vendor's invoice up into one grand total — meters/spacers never carry money, and an
  // `arrears: true` item (see bill-templates.json) is kept apart from the current charge.
  const groupTotals = (g: Group) => {
    const items = g.templates.flatMap((tpl: any) => (Array.isArray(tpl.template?.items) ? tpl.template.items : []))
    const values = g.templates.reduce((acc: Record<string, any>, tpl: any) => ({ ...acc, ...(tpl.template?.values || {}) }), {})
    const money = items.filter((it: any) => it.kind !== 'meter' && it.kind !== 'spacer')
    const arrearsTotal = money.filter((it: any) => it.arrears).reduce((s: number, it: any) => s + (Number(values[it.key]) || 0), 0)
    const total = money.reduce((s: number, it: any) => s + (Number(values[it.key]) || 0), 0)
    return { total, arrearsTotal, currentTotal: total - arrearsTotal }
  }
  const grandCurrent = groups.reduce((s, g) => s + groupTotals(g).currentTotal, 0)
  const grandArrears = groups.reduce((s, g) => s + groupTotals(g).arrearsTotal, 0)

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn secondary"
          type="button"
          onClick={() => setActiveVendor(TOTAL_TAB)}
          style={{
            fontWeight: 700,
            background: activeVendor === TOTAL_TAB ? 'rgba(43,212,213,0.15)' : undefined,
            borderColor: activeVendor === TOTAL_TAB ? 'rgba(43,212,213,0.5)' : undefined,
          }}
        >
          {t('bill.totalAllVendors', 'Total facturi')}
        </button>
        {groups.map((g) => {
          const closedCount = g.templates.filter((tpl: any) => tpl.state === 'CLOSED').length
          const hasValues = g.templates.some((tpl: any) => tpl.template?.values && Object.keys(tpl.template.values).length > 0)
          // A vendor tab is one invoice regardless of how many underlying templates it merges, so it
          // always reports a single aggregate state (never a "1/2"-style per-template ratio) — mirrors
          // BillForm's own billState derivation (allClosed / hasPrefill) so the two never disagree.
          const state = closedCount === g.templates.length ? 'CLOSED' : hasValues ? 'FILLED' : 'NEW'
          const tone = state === 'CLOSED' ? 'positive' : state === 'FILLED' ? 'secondary' : 'warn'
          return (
            <button
              key={g.vendor}
              className="btn secondary"
              type="button"
              onClick={() => setActiveVendor(g.vendor)}
              style={{
                background: activeVendor === g.vendor || (!activeVendor && g === groups[0]) ? 'rgba(43,212,213,0.15)' : undefined,
                borderColor: activeVendor === g.vendor || (!activeVendor && g === groups[0]) ? 'rgba(43,212,213,0.5)' : undefined,
              }}
            >
              {g.vendor} <span className={`badge ${tone}`}>{state}</span>
            </button>
          )
        })}
      </div>

      {activeVendor === TOTAL_TAB ? (
        <div className="card soft" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{t('bill.totalAllVendors', 'Total facturi')}</h2>
          <div className="row" style={{ alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginTop: 2 }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('bill.totalCurrent', 'Curente')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{grandCurrent.toFixed(2)} RON</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('bill.totalArrears', 'Restanțe')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--muted, #666)' }}>{grandArrears.toFixed(2)} RON</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>{t('bill.totalGrand', 'Total general')}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{(grandCurrent + grandArrears).toFixed(2)} RON</div>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--muted, #666)' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 400 }}>{t('unpaid.vendor', 'Furnizor')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 400 }}>{t('bill.totalCurrent', 'Curente')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 400 }}>{t('bill.totalArrears', 'Restanțe')}</th>
                <th style={{ padding: '4px 8px', fontWeight: 700 }}>{t('bill.total', 'Total')}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const s = groupTotals(g)
                return (
                  <tr key={g.vendor} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                    <td style={{ padding: '6px 8px' }}>{g.vendor}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{s.currentTotal ? s.currentTotal.toFixed(2) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--muted, #666)' }}>{s.arrearsTotal ? s.arrearsTotal.toFixed(2) : '—'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{s.total.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : activeTemplates.length ? (
        <>
          <BillForm
            communityId={communityId}
            periodCode={periodCode}
            title={active?.vendor}
            templates={activeTemplates}
            canEdit={canEdit}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
          <AttachmentPane
            communityId={communityId}
            periodCode={periodCode}
            templateCode={activeTemplates[0]?.code || active?.vendor}
            templateType="BILL"
            canEdit={canEdit && !activeTemplates.every((tpl: any) => tpl.state === 'CLOSED')}
          />
        </>
      ) : (
        <div className="muted">{templates.length ? 'No bill template selected.' : 'No bill templates yet.'}</div>
      )}
    </div>
  )
}
