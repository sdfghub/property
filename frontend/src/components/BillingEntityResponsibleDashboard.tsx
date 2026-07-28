import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { BeMonthlyLedger } from './be/BeMonthlyLedger'
import { BeFundsPanel } from './be/BeFundsPanel'
import { BeDueInvoicesPanel } from './be/BeDueInvoicesPanel'
import { MyMeterReadings } from './meters/MyMeterReadings'
import { AvizierPanel } from './community-admin/AvizierPanel'
import { CollectionRatePanel } from './community-admin/CollectionRatePanel'

// Capability flags returned by GET /me/communities/:communityId/capabilities. The backend is the
// authority; these only decide which tabs to render. meters/ledger are per-BE (any sub-role);
// avizier/invoices/funds/collectionRate are whole-community (OWNER / EXPENSE_RESPONSIBLE only).
type Caps = {
  roles: string[]
  can: {
    meters: boolean
    ledger: boolean
    avizier: boolean
    invoices: boolean
    funds: boolean
    collectionRate: boolean
  }
}

type TabKey = 'ledger' | 'meters' | 'avizier' | 'invoices' | 'funds' | 'collection'

export function BillingEntityResponsibleDashboard({
  beId: forcedBeId,
}: {
  beId?: string
  periodCode?: string
}) {
  const { api, activeRole } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const beId = forcedBeId || activeRole?.scopeId || ''
  const [communityId, setCommunityId] = React.useState<string>('')
  const [caps, setCaps] = React.useState<Caps | null>(null)
  const [tab, setTab] = React.useState<TabKey | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Resolve the community from the BE, then load the caller's capabilities for its tab set.
  React.useEffect(() => {
    if (!beId) return
    let alive = true
    api.get<{ communityId: string }>(`/communities/be/${beId}/summary`)
      .then((be: { communityId?: string }) => {
        if (!alive || !be?.communityId) return
        setCommunityId(be.communityId)
        return api.get<Caps>(`/me/communities/${be.communityId}/capabilities`).then((c: Caps) => {
          if (alive) setCaps(c)
        })
      })
      .catch((e: any) => { if (alive) setError(e?.message || 'Nu s-au putut încărca permisiunile') })
    return () => { alive = false }
  }, [api, beId])

  const tabs = React.useMemo(() => {
    const defs: { key: TabKey; label: string; on: boolean }[] = [
      { key: 'ledger', label: t('be.tab.ledger', 'Situație lunară'), on: !!caps?.can.ledger },
      { key: 'meters', label: t('be.tab.meters', 'Contoare'), on: !!caps?.can.meters },
      { key: 'avizier', label: t('be.tab.avizier', 'Avizier'), on: !!caps?.can.avizier },
      { key: 'invoices', label: t('be.tab.invoices', 'Facturi asociație'), on: !!caps?.can.invoices },
      { key: 'funds', label: t('be.tab.funds', 'Fonduri'), on: !!caps?.can.funds },
      { key: 'collection', label: t('be.tab.collection', 'Grad de colectare'), on: !!caps?.can.collectionRate },
    ]
    return defs.filter((d) => d.on)
  }, [caps]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (tabs.length && (!tab || !tabs.some((d) => d.key === tab))) setTab(tabs[0].key)
  }, [tabs, tab])

  if (!beId) return <div className="empty" style={{ marginTop: 18 }}>{t('be.noEntity', 'Nicio unitate asociată contului.')}</div>
  if (error) return <div className="badge negative" style={{ marginTop: 18 }}>{error}</div>
  if (!caps) return <div className="empty" style={{ marginTop: 18 }}>{t('common.loading', 'Se încarcă…')}</div>
  if (!tabs.length) return <div className="empty" style={{ marginTop: 18 }}>{t('be.noAccess', 'Nicio secțiune disponibilă.')}</div>

  const closedPeriodsPath = communityId ? `/communities/${communityId}/periods/closed` : undefined

  return (
    <div className="stack" style={{ marginTop: 18, gap: 14 }}>
      <div className="card">
        <h3 style={{ margin: '0 0 4px' }}>{t('be.viewHeading', 'Unitatea mea')}</h3>
        <p className="muted" style={{ margin: 0 }}>{t('be.viewSubtitle', 'Situația unității și rapoartele asociației.')}</p>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {tabs.map((d) => (
            <button
              key={d.key}
              type="button"
              className={`btn small ${tab === d.key ? 'primary' : 'ghost'}`}
              onClick={() => setTab(d.key)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'ledger' && <BeMonthlyLedger beId={beId} />}
      {tab === 'meters' && communityId && <MyMeterReadings communityId={communityId} />}
      {tab === 'avizier' && communityId && (
        <AvizierPanel
          communityId={communityId}
          readOnly
          reportPath={`/me/communities/${communityId}/avizier`}
          periodsPath={closedPeriodsPath}
        />
      )}
      {tab === 'invoices' && communityId && <BeDueInvoicesPanel communityId={communityId} />}
      {tab === 'funds' && communityId && <BeFundsPanel communityId={communityId} />}
      {tab === 'collection' && communityId && (
        <CollectionRatePanel
          communityId={communityId}
          reportPath={`/me/communities/${communityId}/collection-rate`}
          periodsPath={closedPeriodsPath}
        />
      )}
    </div>
  )
}
