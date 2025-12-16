import React from 'react'
import { useI18n } from '../i18n/useI18n'
import { BillingEntityResponsibleDashboard } from './BillingEntityResponsibleDashboard'

type Be = {
  id: string
  code: string
  name?: string | null
  order?: number | null
  units?: string[]
}

type Responsible = { scopeId: string; user?: { email?: string | null; name?: string | null } }
type PendingInvite = { scopeId: string; email: string }

type Props = {
  be: Be
  responsibles?: Responsible[]
  pending?: PendingInvite[]
}

export function BillingEntityDetails({ be, responsibles = [], pending = [] }: Props) {
  const { t } = useI18n()
  const respForBe = responsibles.filter((r) => r.scopeId === be.id)
  const pendingForBe = pending.filter((p) => p.scopeId === be.id)
  const [expanded, setExpanded] = React.useState(false)

  return (
    <div className="card soft">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h5>{be.name || be.code || t('common.unnamed')}</h5>
        </div>
      </div>

      {be.units && be.units.length > 0 && (
        <div className="muted" style={{ marginTop: 8 }}>
          {t('config.beMembers')}: {be.units.join(', ')}
        </div>
      )}

      <div className="muted" style={{ marginTop: 8 }}>
        {t('config.beResponsibles')}: {respForBe.length} | {t('config.bePendingInvites')}: {pendingForBe.length}
      </div>

      <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setExpanded((v) => !v)}>
        {expanded ? t('be.hideView', 'Hide view') : t('be.view', 'View billing entity')}
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <BillingEntityResponsibleDashboard beId={be.id} />
        </div>
      )}
    </div>
  )
}
