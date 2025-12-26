import React from 'react'
import { useI18n } from '../i18n/useI18n'
import { useAuth } from '../hooks/useAuth'
import { UnitDetails } from './UnitDetails'
import { BillingEntityDetails } from './BillingEntityDetails'

type Props = {
  config: any
  metersConfig?: any
}

export function CommunityConfigViewer({ config, metersConfig }: Props) {
  const { t } = useI18n()
  const { api } = useAuth()
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

  const [activeTab, setActiveTab] = React.useState<'billing' | 'structure' | 'meters' | 'expenses' | 'imports' | 'other'>('billing')
  const [billImportFile, setBillImportFile] = React.useState<File | null>(null)
  const [meterImportFile, setMeterImportFile] = React.useState<File | null>(null)
  const [billImportError, setBillImportError] = React.useState<string | null>(null)
  const [meterImportError, setMeterImportError] = React.useState<string | null>(null)
  const [billImportSuccess, setBillImportSuccess] = React.useState<string | null>(null)
  const [meterImportSuccess, setMeterImportSuccess] = React.useState<string | null>(null)
  const [billImportLoading, setBillImportLoading] = React.useState(false)
  const [meterImportLoading, setMeterImportLoading] = React.useState(false)
  const [coverage, setCoverage] = React.useState<any | null>(null)
  const [coverageError, setCoverageError] = React.useState<string | null>(null)
  const [coverageLoading, setCoverageLoading] = React.useState(false)

  React.useEffect(() => {
    if (!community?.id) return
    let mounted = true
    setCoverageLoading(true)
    setCoverageError(null)
    api
      .get<any>(`/community-config/${community.code}/template-coverage`)
      .then((res) => {
        if (!mounted) return
        setCoverage(res || null)
      })
      .catch((err: any) => {
        if (!mounted) return
        setCoverageError(err?.message || t('config.templates.coverageError'))
      })
      .finally(() => {
        if (mounted) setCoverageLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [api, community?.code, community?.id])

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {(['billing', 'structure', 'meters', 'expenses', 'imports', 'other'] as const).map((k) => (
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
              {meters.slice(0, 12).map((m: any) => {
                const missing = isMeterMissing(m, coverage)
                return (
                  <li key={m.meterId}>
                    {m.meterId} — {m.typeCode} [{m.scopeType}/{m.scopeCode}]
                    {missing ? (
                      <span className="badge warn" style={{ marginLeft: 6 }}>
                        {t('config.templates.badge.missingTemplate')}
                      </span>
                    ) : null}
                  </li>
                )
              })}
              {meters.length > 12 && <li className="muted">+{meters.length - 12} more</li>}
            </ul>
          </Section>

          <Section title={t('config.templates.status.meter')}>
            {coverageLoading && <div className="muted">{t('config.templates.loading')}</div>}
            {coverageError && <div className="badge negative">{coverageError}</div>}
            {!coverageLoading && !coverageError && coverage?.period && (
              <>
                <div className="muted">
                  {t('card.period.label')}: {coverage.period.code}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <span className="badge">
                    {t('config.templates.label.templates')}: {coverage.templates?.meter ?? 0}
                  </span>
                  <span className="badge">
                    {t('config.templates.label.meters')}: {meters.length}
                  </span>
                  <span className="badge">
                    {t('config.templates.label.covered')}: {countCoveredMetersFromCoverage(meters, coverage)}
                  </span>
                  <span className="badge warn">
                    {t('config.templates.label.missing')}: {coverage.meters?.missing ?? 0}
                  </span>
                </div>
                {meters.length > 0 && (
                  <div className="muted" style={{ marginTop: 8 }}>
                    {t('config.templates.label.missingMeters')}:{' '}
                    {listMissingMetersFromCoverage(meters, coverage)
                      .slice(0, 8)
                      .join(', ') || t('common.none')}
                    {(coverage.meters?.missing ?? 0) > 8 ? '…' : ''}
                  </div>
                )}
              </>
            )}
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

      {activeTab === 'imports' && (
        <div className="grid two">
          <Section title={t('config.import.bill.title')}>
            <div className="muted">{t('config.import.bill.subtitle')}</div>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="file"
                accept="application/json"
                onChange={(e) => {
                  setBillImportFile(e.target.files?.[0] || null)
                  setBillImportError(null)
                  setBillImportSuccess(null)
                }}
              />
              <button
                className="btn primary small"
                type="button"
                disabled={billImportLoading}
                onClick={async () => {
                  if (!community?.id) return
                  if (!billImportFile) {
                    setBillImportError(t('config.import.pickFile'))
                    setBillImportSuccess(null)
                    return
                  }
                  setBillImportLoading(true)
                  setBillImportError(null)
                  setBillImportSuccess(null)
                  try {
                    const raw = await billImportFile.text()
                    const parsed = JSON.parse(raw)
                    await api.post(`/communities/${community.id}/bill-templates/import`, parsed)
                    setBillImportFile(null)
                    setBillImportSuccess(t('config.import.success.bill'))
                  } catch (err: any) {
                    setBillImportError(err?.message || t('config.import.error.bill'))
                  } finally {
                    setBillImportLoading(false)
                  }
                }}
              >
                {billImportLoading ? t('config.import.loading') : t('config.import.button')}
              </button>
              {billImportError && <span className="badge negative">{billImportError}</span>}
              {billImportSuccess && <span className="badge positive">{billImportSuccess}</span>}
            </div>
          </Section>

          <Section title={t('config.import.meter.title')}>
            <div className="muted">{t('config.import.meter.subtitle')}</div>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                type="file"
                accept="application/json"
                onChange={(e) => {
                  setMeterImportFile(e.target.files?.[0] || null)
                  setMeterImportError(null)
                  setMeterImportSuccess(null)
                }}
              />
              <button
                className="btn primary small"
                type="button"
                disabled={meterImportLoading}
                onClick={async () => {
                  if (!community?.id) return
                  if (!meterImportFile) {
                    setMeterImportError(t('config.import.pickFile'))
                    setMeterImportSuccess(null)
                    return
                  }
                  setMeterImportLoading(true)
                  setMeterImportError(null)
                  setMeterImportSuccess(null)
                  try {
                    const raw = await meterImportFile.text()
                    const parsed = JSON.parse(raw)
                    await api.post(`/communities/${community.id}/meter-templates/import`, parsed)
                    setMeterImportFile(null)
                    setMeterImportSuccess(t('config.import.success.meter'))
                  } catch (err: any) {
                    setMeterImportError(err?.message || t('config.import.error.meter'))
                  } finally {
                    setMeterImportLoading(false)
                  }
                }}
              >
                {meterImportLoading ? t('config.import.loading') : t('config.import.button')}
              </button>
              {meterImportError && <span className="badge negative">{meterImportError}</span>}
              {meterImportSuccess && <span className="badge positive">{meterImportSuccess}</span>}
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'expenses' && (
        <>
          <Section title={t('config.templates.status.bill')} style={{ width: '100%', gridColumn: '1 / -1' }}>
            {coverageLoading && <div className="muted">{t('config.templates.loading')}</div>}
            {coverageError && <div className="badge negative">{coverageError}</div>}
            {!coverageLoading && !coverageError && coverage?.period && (
              <>
                <div className="muted">
                  {t('card.period.label')}: {coverage.period.code}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <span className="badge">
                    {t('config.templates.label.templates')}: {coverage.templates?.bill ?? 0}
                  </span>
                  <span className="badge">
                    {t('config.templates.label.expenseSplits')}: {expenseSplits.length}
                  </span>
                  <span className="badge">
                    {t('config.templates.label.covered')}: {countCoveredSplitsFromCoverage(expenseSplits, coverage)}
                  </span>
                  <span className="badge warn">
                    {t('config.templates.label.missing')}: {coverage.expenseSplits?.missing ?? 0}
                  </span>
                </div>
                {expenseSplits.length > 0 && (
                  <div className="muted" style={{ marginTop: 8 }}>
                    {t('config.templates.label.missingExpenseTypes')}:{' '}
                    {listMissingSplitsFromCoverage(expenseSplits, coverage)
                      .slice(0, 8)
                      .join(', ') || t('common.none')}
                    {(coverage.expenseSplits?.missing ?? 0) > 8 ? '…' : ''}
                  </div>
                )}
              </>
            )}
          </Section>
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
                const missing = isSplitMissing(es, coverage)
                return (
                  <li key={es.splitName || es.expenseName || es.expenseTypeName || idx}>
                    <div>
                      <strong>{displayName}</strong>
                      {missing ? (
                        <span className="badge warn" style={{ marginLeft: 6 }}>
                          {t('config.templates.badge.missingBillEntry')}
                        </span>
                      ) : null}
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

function missingMeterSet(coverage: any) {
  const ids = (coverage?.meters?.missingIds || []) as string[]
  return new Set(ids)
}

function isMeterMissing(meter: any, coverage: any) {
  if (!coverage) return false
  return missingMeterSet(coverage).has(meter.meterId)
}

function listMissingMetersFromCoverage(meters: any[], coverage: any) {
  if (!coverage) return []
  const missing = missingMeterSet(coverage)
  return meters.filter((m) => missing.has(m.meterId)).map((m) => m.meterId || m.name || 'unknown')
}

function countCoveredMetersFromCoverage(meters: any[], coverage: any) {
  if (!coverage) return 0
  const missingCount = coverage.meters?.missing ?? 0
  return Math.max(0, meters.length - missingCount)
}

function missingSplitSet(coverage: any) {
  const codes = (coverage?.expenseSplits?.missingCodes || []) as string[]
  return new Set(codes)
}

function isSplitMissing(split: any, coverage: any) {
  if (!coverage) return false
  const code = split?.expenseTypeCode
  return !!code && missingSplitSet(coverage).has(code)
}

function listMissingSplitsFromCoverage(expenseSplits: any[], coverage: any) {
  if (!coverage) return []
  const missing = missingSplitSet(coverage)
  return expenseSplits
    .filter((s) => missing.has(s.expenseTypeCode))
    .map((s) => s.expenseTypeCode || s.expenseTypeName || 'unknown')
}

function countCoveredSplitsFromCoverage(expenseSplits: any[], coverage: any) {
  if (!coverage) return 0
  const missingCount = coverage.expenseSplits?.missing ?? 0
  return Math.max(0, expenseSplits.length - missingCount)
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
