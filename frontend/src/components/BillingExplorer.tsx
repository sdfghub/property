import React from 'react'
// Billing drill-down UI shared by community admins and BE responsibles.
// Lets a user pick a period, list billing entities, inspect a BE, and drill into allocations.
import { useAuth } from '../hooks/useAuth'
import type {
  BillingEntity,
  BillingEntityAllocationsResponse,
  BillingEntityListResponse,
  BillingEntityMembersResponse,
  Community,
  MemberAllocationsResponse,
} from '../api/types'
import { useI18n } from '../i18n/useI18n'

type Props = { community: Community }

export function BillingExplorer({ community }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [periodCode, setPeriodCode] = React.useState('')
  const [entities, setEntities] = React.useState<BillingEntityListResponse | null>(null)
  const [activeBe, setActiveBe] = React.useState<string | null>(null)
  const [members, setMembers] = React.useState<BillingEntityMembersResponse | null>(null)
  const [allocations, setAllocations] = React.useState<BillingEntityAllocationsResponse | null>(null)
  const [memberAlloc, setMemberAlloc] = React.useState<MemberAllocationsResponse | null>(null)
  const [unitCode, setUnitCode] = React.useState('')
  const [message, setMessage] = React.useState<string | null>(null)
  const [loadingList, setLoadingList] = React.useState(false)
  const [loadingBe, setLoadingBe] = React.useState(false)

  React.useEffect(() => {
    // Reset state when switching communities so old data does not leak.
    setEntities(null)
    setActiveBe(null)
    setMembers(null)
    setAllocations(null)
    setMemberAlloc(null)
    setPeriodCode('')
  }, [community.id])

  // Load billing entities for a given period code.
  async function loadEntities() {
    if (!periodCode) {
      setMessage(t('billing.periodNeeded'))
      return
    }
    setMessage(null)
    setLoadingList(true)
    setMembers(null)
    setAllocations(null)
    setMemberAlloc(null)
    setActiveBe(null)
    try {
      const data = await api.get<BillingEntityListResponse>(
        `/communities/${community.id}/periods/${periodCode}/billing-entities`,
      )
      setEntities(data)
    } catch (err: any) {
      setMessage(err?.message || 'Could not load billing entities')
    } finally {
      setLoadingList(false)
    }
  }

  // Drill into a single billing entity (members + allocations).
  async function loadBillingEntity(beCode: string) {
    if (!periodCode) return
    setActiveBe(beCode)
    setLoadingBe(true)
    setMessage(null)
    setMemberAlloc(null)
    try {
      const [m, a] = await Promise.all([
        api.get<BillingEntityMembersResponse>(
          `/communities/${community.id}/periods/${periodCode}/billing-entities/${beCode}`,
        ),
        api.get<BillingEntityAllocationsResponse>(
          `/communities/${community.id}/periods/${periodCode}/billing-entities/${beCode}/allocations`,
        ),
      ])
      setMembers(m)
      setAllocations(a)
    } catch (err: any) {
      setMessage(err?.message || 'Could not load billing entity')
    } finally {
      setLoadingBe(false)
    }
  }

  // Optional drilldown for a specific unit inside the selected BE.
  async function loadMemberAllocations() {
    if (!activeBe || !unitCode || !periodCode) return
    setMessage(null)
    try {
      const data = await api.get<MemberAllocationsResponse>(
        `/communities/${community.id}/periods/${periodCode}/billing-entities/${activeBe}/members/${unitCode}/allocations`,
      )
      setMemberAlloc(data)
    } catch (err: any) {
      setMessage(err?.message || 'Could not load member allocations')
    }
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{community.name}</h2>
          <div className="muted">
            {t('billing.communityLabel')}: {community.code}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="label">
            <span>{t('billing.periodLabel')}</span>
            <span className="muted">{t('billing.periodExample')}</span>
          </label>
          <input
            className="input"
            value={periodCode}
            placeholder="YYYY-MM"
            onChange={(e) => setPeriodCode(e.target.value)}
          />
        </div>
        <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={loadEntities} disabled={loadingList}>
          {loadingList ? t('billing.loading') : t('billing.loadEntities')}
        </button>
      </div>

      {message && <div className="badge negative">{message}</div>}

      {entities && (
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3>{t('billing.entitiesTitle')}</h3>
            <div className="badge">
              {t('billing.periodBadge', { code: entities.period.code })}
            </div>
          </div>
          <BillingEntityTable
            rows={entities.items}
            onSelect={loadBillingEntity}
            selectedCode={activeBe ?? undefined}
            loading={loadingBe}
            t={t}
          />
        </div>
      )}

      {activeBe && members && allocations && (
        <div className="grid two">
          <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{t('billing.membersTitle', { code: members.be.code })}</h3>
              <div className="badge">
                {t('billing.membersCount', { count: members.members.length })}
              </div>
            </div>
            {members.members.length === 0 ? (
              <div className="empty">{t('billing.noMembers')}</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('billing.table.unit')}</th>
                    <th style={{ textAlign: 'right' }}>{t('billing.table.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.members.map((m) => (
                    <tr key={m.unit_id}>
                      <td>{m.unit_code}</td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(m.unit_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="stack" style={{ marginTop: 12 }}>
              <label className="label">
                <span>{t('billing.inspectUnit')}</span>
                <span className="muted">{t('billing.inspectUnitNote')}</span>
              </label>
              <div className="row">
                <input
                  className="input"
                  placeholder={t('billing.unitPlaceholder')}
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                />
                <button className="btn secondary" type="button" onClick={loadMemberAllocations}>
                  {t('billing.load')}
                </button>
              </div>
              {memberAlloc && <MemberAllocations data={memberAlloc} t={t} />}
            </div>
          </div>

          <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{t('billing.allocationsTitle')}</h3>
              <div className="badge">{t('billing.allocationsCount', { count: allocations.lines.length })}</div>
            </div>
            {allocations.lines.length === 0 ? (
              <div className="empty">{t('billing.noAllocations')}</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('billing.table.unit')}</th>
                    <th>{t('billing.table.expense')}</th>
                    <th>{t('billing.table.type')}</th>
                    <th style={{ textAlign: 'right' }}>{t('billing.table.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.lines.map((l) => (
                    <tr key={l.allocation_id}>
                      <td>{l.unit_code}</td>
                      <td>{l.expense_description}</td>
                      <td>
                        <span className="badge">{l.expense_type_code}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatMoney(l.amount, l.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BillingEntityTable({
  rows,
  onSelect,
  selectedCode,
  loading,
  t,
}: {
  rows: BillingEntity[]
  onSelect: (code: string) => void
  selectedCode?: string
  loading: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  if (rows.length === 0) return <div className="empty">{t('billing.noEntities')}</div>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{t('billing.table.code')}</th>
          <th>{t('billing.table.name')}</th>
          <th style={{ textAlign: 'right' }}>{t('billing.table.total')}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((be) => (
          <tr key={be.id}>
            <td>{be.code}</td>
            <td>{be.name}</td>
            <td style={{ textAlign: 'right' }}>{formatMoney(be.total_amount)}</td>
            <td style={{ textAlign: 'right' }}>
              <button
                className="btn secondary"
                style={{ padding: '8px 10px' }}
                onClick={() => onSelect(be.code)}
                disabled={loading && selectedCode === be.code}
              >
                {loading && selectedCode === be.code ? t('billing.loading') : t('billing.inspect')}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MemberAllocations({
  data,
  t,
}: {
  data: MemberAllocationsResponse
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <div className="card" style={{ borderColor: 'rgba(43,212,213,0.5)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>
          {t('billing.memberAllocTitle', { unit: data.unit.code, period: data.period.code })}
        </strong>
        <span className="badge positive">{formatMoney(data.total)}</span>
      </div>
      {data.lines.length === 0 ? (
        <div className="empty">{t('billing.noMemberAlloc')}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('billing.table.expense')}</th>
              <th>{t('billing.table.type')}</th>
              <th style={{ textAlign: 'right' }}>{t('billing.table.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.allocation_id}>
                <td>{l.expense_description}</td>
                <td>{l.expense_type_code}</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(l.amount, l.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function formatMoney(amount: number, currency = 'RON') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(
    Number(amount ?? 0),
  )
}
