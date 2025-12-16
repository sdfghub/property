import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import type { Community } from '../../api/types'
import { CommunityUsersPanel } from '../CommunityUsersPanel'
import { CommunityExpensesPanel } from '../CommunityExpensesPanel'
import { CommunityMetersPanel } from '../CommunityMetersPanel'
import { PeriodAdmin } from '../PeriodAdmin'
import { OverviewTab } from './OverviewTab'
import { ConfigTab } from './ConfigTab'
import { ProgramsTab } from './ProgramsTab'

type Props = {
  forceCommunityId?: string
}

type TabKey =
  | 'overview'
  | 'config'
  | 'meters'
  | 'expenses'
  | 'programs'
  | 'statements'
  | 'users'
  | 'health'
  | 'periodFocus'

export function CommunityAdminDashboard({ forceCommunityId }: Props) {
  const { api, activeRole } = useAuth()
  const { t } = useI18n()
  const [communities, setCommunities] = React.useState<Community[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<TabKey>('overview')
  const [configJson, setConfigJson] = React.useState<any>(null)
  const [configError, setConfigError] = React.useState<string | null>(null)
  const [metersConfig, setMetersConfig] = React.useState<any | null>(null)
  const [programs, setPrograms] = React.useState<any[]>([])
  const [programError, setProgramError] = React.useState<string | null>(null)
  const [editablePeriod, setEditablePeriod] = React.useState<{
    period?: { code: string; status: string }
    meters?: { total: number; closed: number; open?: string[] }
    bills?: { total: number; closed: number; open?: string[] }
    canClose?: boolean
    canPrepare?: boolean
  } | null>(null)
  const [lastClosed, setLastClosed] = React.useState<{ code: string; closedAt?: string } | null>(null)
  const [busy, setBusy] = React.useState<null | 'prepare' | 'close' | 'reopen' | 'create'>(null)
  const [summary, setSummary] = React.useState<any | null>(null)
  const [summaryError, setSummaryError] = React.useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = React.useState(false)

  const workspaceTabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('tab.overview') || 'Overview' },
    { key: 'config', label: t('tab.config') || 'Config' },
    { key: 'programs', label: t('tab.programs') || 'Programs' },
    { key: 'users', label: t('tab.users') || 'Users' },
    { key: 'health', label: t('tab.health') || 'Health' },
  ]
  const periodTabs: Array<{ key: TabKey; label: string }> = [
    { key: 'periodFocus', label: t('tab.periodFocus') || 'Period' },
    { key: 'meters', label: t('tab.meters') || 'Meters' },
    { key: 'expenses', label: t('tab.expenses') || 'Expenses' },
    { key: 'statements', label: t('tab.statements') || 'Statements' },
  ]
  const isPeriodTab = periodTabs.some((t) => t.key === activeTab)

  React.useEffect(() => {
    const endpoint = forceCommunityId ? '/communities/public' : '/communities'
    api
      .get<Community[]>(endpoint)
      .then((rows) => {
        setCommunities(rows)
        const scopedId = forceCommunityId || activeRole?.scopeId
        if (scopedId) {
          setSelectedId(scopedId)
        } else if (rows.length) {
          setSelectedId(rows[0].id)
        }
      })
      .catch((err: any) => {
        if (forceCommunityId) {
          const fallback = { id: forceCommunityId, code: forceCommunityId, name: forceCommunityId } as Community
          setCommunities([fallback])
          setSelectedId(forceCommunityId)
        } else {
          setMessage(err?.message || 'Could not load communities')
        }
      })
  }, [api, activeRole?.scopeId, forceCommunityId])

  const activeCommunity = communities.find((c) => c.id === selectedId) ?? null
  const communityCode = activeCommunity?.code || forceCommunityId || ''
  const communityId = activeCommunity?.id || forceCommunityId || ''

  const refreshEditable = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    return api
      .get<any>(`/communities/${communityCode}/periods/editable`)
      .then((res) => setEditablePeriod(res))
      .catch(() => setEditablePeriod(null))
  }, [api, communityCode])

  const refreshClosed = React.useCallback(() => {
    if (!communityCode) return Promise.resolve()
    return api
      .get<Array<{ id: string; code: string; status: string; closedAt?: string }>>(`/communities/${communityCode}/periods/closed`)
      .then((rows) => {
        const last = rows?.[0]
        if (last?.status === 'CLOSED') {
          setLastClosed({ code: last.code, closedAt: (last as any).closedAt })
        } else {
          setLastClosed(null)
        }
      })
      .catch(() => setLastClosed(null))
  }, [api, communityCode])

  React.useEffect(() => {
    if (!communityCode) return
    const controller = new AbortController()
    const loadSummary = async () => {
      if (!editablePeriod?.period?.code) {
        setSummary(null)
        setSummaryError(null)
        setSummaryLoading(false)
        return
      }
      setSummaryLoading(true)
      setSummaryError(null)
      try {
        const data = await api.get<any>(
          `/communities/${communityCode}/periods/${editablePeriod.period.code}/summary`,
          undefined,
          controller.signal as any,
        )
        setSummary(data || null)
      } catch (err: any) {
        if (controller.signal.aborted) return
        setSummary(null)
        setSummaryError(err?.message || 'Failed to load summary')
      } finally {
        if (!controller.signal.aborted) setSummaryLoading(false)
      }
    }
    loadSummary()
    return () => controller.abort()
  }, [api, communityCode, editablePeriod?.period?.code])

  React.useEffect(() => {
    if (!communityCode) {
      setSummary(null)
      setSummaryError(null)
    }
  }, [communityCode])

  React.useEffect(() => {
    if (!communityCode) return
    setConfigError(null)
    setProgramError(null)
    const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:3000/api'
    fetch(`${apiBase}/community-config/${communityCode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then(setConfigJson)
      .catch((err) => setConfigError(err?.message || 'Failed to load config'))

    fetch(`${apiBase}/community-programs/${communityCode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((rows) => setPrograms(Array.isArray(rows) ? rows : []))
      .catch((err) => setProgramError(err?.message || 'Failed to load programs'))

    refreshEditable()
    refreshClosed()
  }, [communityCode, refreshEditable, refreshClosed])

  React.useEffect(() => {
    if (!communityCode) return
    if (activeTab !== 'meters' && activeTab !== 'config') return
    if (metersConfig && (metersConfig as any).__communityCode === communityCode) return
    const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:3000/api'
    fetch(`${apiBase}/community-config/${communityCode}/meters`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data) => setMetersConfig({ ...data, __communityCode: communityCode }))
      .catch(() => setMetersConfig(null))
  }, [communityCode, activeTab, metersConfig])

  const handlePrepare = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setBusy('prepare')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/prepare`)
      await refreshEditable()
    } catch (err: any) {
      setMessage(err?.message || 'Failed to prepare period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, editablePeriod?.period?.code, refreshEditable])

  const handleClose = React.useCallback(async () => {
    if (!communityId || !editablePeriod?.period?.code) return
    try {
      setMessage(null)
      setBusy('close')
      await api.post(`/communities/${communityId}/periods/${editablePeriod.period.code}/approve`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to close period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, editablePeriod?.period?.code, refreshEditable, refreshClosed])

  const handleReopen = React.useCallback(async () => {
    if (!communityId || !lastClosed?.code) return
    try {
      setMessage(null)
      setBusy('reopen')
      await api.post(`/communities/${communityId}/periods/${lastClosed.code}/reopen`)
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to reopen period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, lastClosed?.code, refreshEditable, refreshClosed])

  const handleCreatePeriod = React.useCallback(async () => {
    if (!communityId) return
    try {
      setMessage(null)
      setBusy('create')
      await api.post(`/communities/${communityId}/periods/create`, {})
      await Promise.all([refreshEditable(), refreshClosed()])
    } catch (err: any) {
      setMessage(err?.message || 'Failed to create period')
    } finally {
      setBusy(null)
    }
  }, [api, communityId, refreshClosed, refreshEditable])

  if (!activeCommunity && !selectedId) {
    return (
      <div className="grid one" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="empty">{t('communities.empty')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid one" style={{ marginTop: 18 }}>
      <div className="card">
        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3>{activeCommunity?.name || forceCommunityId || 'Community'}</h3>
              <div className="muted">
                {t('billing.communityLabel')}: {activeCommunity?.code || forceCommunityId || 'N/A'}
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {/*<div className="muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {t('nav.workspace') || 'Workspace'}
              </div>*/}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {workspaceTabs.map((tab) => (
                  <button
                    key={tab.key}
                    className="btn secondary"
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      padding: '8px 12px',
                      background: activeTab === tab.key ? 'rgba(43,212,213,0.15)' : undefined,
                      borderColor: activeTab === tab.key ? 'rgba(43,212,213,0.5)' : undefined,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/*
              <div className="muted" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 4 }}>
                {t('nav.periodWork') || 'Period work'}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {periodTabs.map((tab) => (
                  <button
                    key={tab.key}
                    className="btn secondary"
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      padding: '8px 12px',
                      background: activeTab === tab.key ? 'rgba(43,212,213,0.15)' : undefined,
                      borderColor: activeTab === tab.key ? 'rgba(43,212,213,0.5)' : undefined,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              */}
            </div>
          </div>

          {activeTab === 'overview' && (
            <OverviewTab
              editablePeriod={editablePeriod}
              onGoPeriod={() => setActiveTab('periodFocus')}
              onGoMeters={() => setActiveTab('meters')}
              onGoBills={() => setActiveTab('expenses')}
              onPrepare={handlePrepare}
              onClose={handleClose}
              busy={busy}
              onRecompute={() => {
                if (!communityId || !editablePeriod?.period?.code) return
                setMessage(null)
                setBusy('prepare')
                api
                  .post(`/communities/${communityId}/periods/${editablePeriod.period.code}/recompute`)
                  .then(() => refreshEditable())
                  .catch((err: any) => setMessage(err?.message || 'Failed to recompute allocations'))
                  .finally(() => setBusy(null))
              }}
              lastClosed={lastClosed}
              onReopen={handleReopen}
              onCreatePeriod={handleCreatePeriod}
              summary={summary}
              summaryError={summaryError}
              summaryLoading={summaryLoading}
              onGoStatements={() => setActiveTab('statements')}
            />
          )}

          {activeTab === 'meters' && (
            <CommunityMetersPanel
              communityId={activeCommunity!.id}
              onStatusChange={() => refreshEditable()}
            />
          )}

          {activeTab === 'periodFocus' && <PeriodAdmin communityId={activeCommunity!.id} communityCode={activeCommunity!.code} />}

          {activeTab === 'config' && (
            <ConfigTab configJson={configJson} metersConfig={metersConfig} configError={configError} loadingLabel={t('config.loading')} />
          )}

          {activeTab === 'expenses' && (
            <CommunityExpensesPanel
              communityId={activeCommunity!.id}
              onBillStatusChange={() => refreshEditable()}
            />
          )}

          {activeTab === 'programs' && <ProgramsTab programs={programs} programError={programError} />}

          {activeTab === 'statements' && (
            <div className="stack">
              <h4>{t('statements.heading')}</h4>
              <p className="muted">{t('statements.subtitle')}</p>
            </div>
          )}

          {activeTab === 'users' && <CommunityUsersPanel communityId={activeCommunity!.id} />}

          {activeTab === 'health' && (
            <div className="stack">
              <h4>{t('health.heading')}</h4>
              <p className="muted">{t('health.subtitle')}</p>
            </div>
          )}

          {message && <div className="badge negative">{message}</div>}
        </div>
      </div>
    </div>
  )
}
