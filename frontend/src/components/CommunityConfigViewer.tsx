import React from 'react'
import { useI18n } from '../i18n/useI18n'
import { UnitDetails } from './UnitDetails'
import { BillingEntityDetails } from './BillingEntityDetails'

type Props = {
  config: any
  metersConfig?: any
}

export function CommunityConfigViewer({ config, metersConfig }: Props) {
  const { t } = useI18n()
  if (!config) return null

  const {
    community,
    units = [],
    unitGroups = [],
    unitGroupMembers = [],
    meters: cfgMeters = [],
    aggregationRules: cfgAgg = [],
    derivedMeters: cfgDerived = [],
    measureTypes: cfgMeasure = [],
    bucketRules = [],
    allocationRules = [],
    expenseSplits = [],
    splitGroups = [],
    splitGroupMembers = [],
    billingEntities = [],
    beResponsibles = [],
    bePendingInvites = [],
  } = config
  const meters = metersConfig?.meters ?? cfgMeters
  const aggregationRules = metersConfig?.aggregationRules ?? cfgAgg
  const derivedMeters = metersConfig?.derivedMeters ?? cfgDerived
  const measureTypes = metersConfig?.measureTypes ?? cfgMeasure

  const sortedUnits = React.useMemo(
    () =>
      [...units].sort((a: any, b: any) => {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER
        const ob = b.order ?? Number.MAX_SAFE_INTEGER
        if (oa !== ob) return oa - ob
        return String(a.code).localeCompare(String(b.code))
      }),
    [units],
  )

  const sortedBes = React.useMemo(
    () =>
      [...billingEntities].sort((a: any, b: any) => {
        const oa = a.order ?? Number.MAX_SAFE_INTEGER
        const ob = b.order ?? Number.MAX_SAFE_INTEGER
        if (oa !== ob) return oa - ob
        return String(a.code).localeCompare(String(b.code))
      }),
    [billingEntities],
  )

  const [activeTab, setActiveTab] = React.useState<'billing' | 'structure' | 'meters' | 'expenses' | 'other'>('billing')

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {(['billing', 'structure', 'meters', 'expenses', 'other'] as const).map((k) => (
          <button
            key={k}
            className="btn secondary"
            type="button"
            onClick={() => setActiveTab(k)}
            style={{
              padding: '8px 12px',
              background: activeTab === k ? 'rgba(43,212,213,0.15)' : undefined,
              borderColor: activeTab === k ? 'rgba(43,212,213,0.5)' : undefined,
            }}
          >
            {t(`config.tab.${k}`, k)}
          </button>
        ))}
      </div>

      {activeTab === 'billing' && (
        <Section title={`${t('config.billingEntities', 'Billing entities')} (${sortedBes.length})`}>
          <div className="stack">
            {sortedBes.map((be: any) => (
              <BillingEntityDetails
                key={be.id || be.code}
                be={be}
                responsibles={beResponsibles}
                pending={bePendingInvites}
              />
            ))}
          </div>
        </Section>
      )}

      {activeTab === 'structure' && (
        <>
          {units && unitGroupMembers && unitGroups && (
            <UnitSection units={sortedUnits} unitGroupMembers={unitGroupMembers} groups={unitGroups} meters={meters} />
          )}
          <Section title={`${t('config.unitGroups')} (${unitGroups.length})`}>
            <ul className="muted">
              {unitGroups.map((g: any) => (
                <li key={g.code}>
                  <strong>{g.name || g.code}</strong> — {groupSize(g.id, unitGroupMembers)} members
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}

      {activeTab === 'meters' && (
        <div className="grid two">
          <Section title={`${t('config.meters')} (${meters.length})`}>
            <ul className="muted">
              {meters.slice(0, 12).map((m: any) => (
                <li key={m.meterId}>
                  {m.meterId} — {m.typeCode} [{m.scopeType}/{m.scopeCode}]
                </li>
              ))}
              {meters.length > 12 && <li className="muted">+{meters.length - 12} more</li>}
            </ul>
          </Section>

          <Section title={`${t('config.measureTypes', 'Measure types')} (${measureTypes?.length || 0})`}>
            <ul className="muted">
              {(measureTypes || []).map((m: any) => (
                <li key={m.code}>
                  <strong>{m.name || m.code}</strong> — {m.unit}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t('config.aggregations')}>
            <div className="stack">
              <div>
                <div className="muted">
                  {t('config.aggregations')} ({aggregationRules.length})
                </div>
                <ul className="muted">
                  {aggregationRules.map((r: any) => (
                    <li key={r.targetType}>
                      {r.targetType} ← [{(r.unitTypes || []).join(', ')}] residual: {r.residualType || '-'}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="muted">
                  {t('config.derivedMeters')} ({derivedMeters.length})
                </div>
                <ul className="muted">
                  {derivedMeters.map((r: any) => (
                    <li key={`${r.scopeType}-${r.targetType}`}>
                      {r.targetType} from {r.sourceType} minus [{(r.subtractTypes || []).join(', ')}]
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'expenses' && (
        <>
          <Section title={t('config.expenseSplits', 'Expense splits')} style={{ width: '100%', gridColumn: '1 / -1' }}>
            <ul className="muted">
              {expenseSplits.map((es: any, idx: number) => {
                const lines = Array.isArray(es.lines) ? es.lines : []
                if (!lines.length) return null
                const displayName = (
                  (es.splitName || '').trim() ||
                  (es.expenseName || '').trim() ||
                  (es.expenseTypeName || '').trim() ||
                  t('common.unnamed')
                )
                return (
                  <li key={es.splitName || es.expenseName || es.expenseTypeName || idx}>
                    <div>
                      <strong>{displayName}</strong>
                    </div>
                    {lines.map((line, i) => (
                      <div
                        key={`${displayName}-${i}-${line.text || 'line'}`}
                        style={{ paddingLeft: 12 * (line.depth + 1) }}
                      >
                        <div>
                          {line.depth >= 1 ? '↳' : '•'} {line.text}
                          {line.meta ? ` (${line.meta})` : ''}
                        </div>
                        {line.extra ? (
                          <div className="muted" style={{ marginLeft: 12 }}>
                            {line.extra}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section title={`${t('config.splitGroups')} (${splitGroups.length})`}>
            <ul className="muted">
              {splitGroups
                .slice()
                .sort((a: any, b: any) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
                .map((g: any) => {
                  const members = splitGroupMembers.filter((m: any) => m.splitGroupId === g.id).map((m: any) => m.splitNodeId)
                  return (
                    <li key={g.code}>
                      <strong>{g.name || g.code}</strong>
                      {members.length > 1 ? (
                        <div>
                          {t('config.splitGroupComponents')}:{' '}
                          {members.map((id: string) => config.splitNodeNames?.[id] || id).join(', ')}
                        </div>
                      ) : null}
                    </li>
                  )
                })}
            </ul>
          </Section>
        </>
      )}

      {activeTab === 'other' && (
        <>
          <div className="card soft">
            <div className="muted">{t('config.community')}</div>
            <h3>{community?.name || community?.code || t('config.community')}</h3>
            <div className="muted">{community?.code}</div>
          </div>

          <div className="grid two">
            <Section title={`${t('config.bucketRules')} (${bucketRules.length})`}>
              <ul className="muted">
                {bucketRules.map((b: any, idx: number) => (
                  <li key={b.code || idx}>
                    {b.code} — priority {b.priority}
                  </li>
                ))}
              </ul>
            </Section>

            <Section title={`${t('config.allocationRules', 'Allocation rules')} (${allocationRules.length})`}>
              <ul className="muted">
                {allocationRules.map((r: any, idx: number) => (
                  <li key={r.code || idx}>
                    {r.name || r.method ? t(`alloc.${r.method || r.name}` as any, r.method || r.name) : t('common.unnamed')}
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  children,
  className,
  style,
}: {
  title: string
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`card soft ${className || ''}`.trim()} style={style}>
      <h4>{title}</h4>
      {children}
    </div>
  )
}

function groupSize(groupId: string, members: any[]) {
  return members.filter((m) => m.groupId === groupId).length
}

function memberCount(groupId: string, members: any[]) {
  return members.filter((m) => m.splitGroupId === groupId).length
}
function UnitSection({
  units,
  unitGroupMembers,
  groups,
  meters,
}: {
  units: any[]
  unitGroupMembers: any[]
  groups: any[]
  meters: any[]
}) {
  const { t } = useI18n()
  const byUnit = new Map<string, string[]>()
  unitGroupMembers.forEach((m) => {
    const list = byUnit.get(m.unitId) ?? []
    list.push(m.groupId)
    byUnit.set(m.unitId, list)
  })
  const metersByUnit = new Map<string, any[]>()
  meters
    .filter((m) => m.scopeType === 'UNIT')
    .forEach((m) => {
      const list = metersByUnit.get(m.scopeCode) ?? []
      list.push(m)
      metersByUnit.set(m.scopeCode, list)
    })
  return (
    <Section title={`${t('config.units')} (${units.length})`}>
      <div className="stack">
        {units.map((u: any) => (
          <UnitDetails
            key={u.id || u.code}
            unit={u}
            groupCodes={byUnit.get(u.id || '')}
            groups={groups}
            meters={metersByUnit.get(u.code) ?? []}
          />
        ))}
      </div>
    </Section>
  )
}
