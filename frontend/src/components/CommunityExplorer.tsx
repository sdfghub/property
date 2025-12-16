import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import type { Community } from '../api/types'
import { BillingExplorer } from './BillingExplorer'

// Shared community picker that feeds the billing explorer; used by mixed roles.
// This is the default surface for users that have roles but are not scoped to a single community.

export function CommunityExplorer() {
  const { t } = useI18n()
  const { api, user } = useAuth()
  const [communities, setCommunities] = React.useState<Community[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')

  React.useEffect(() => {
    // Query communities whenever the search term changes or a user logs in.
    if (!user) return
    setLoading(true)
    const query = search ? `?q=${encodeURIComponent(search)}` : ''
    api
      .get<Community[]>(`/communities${query}`)
      .then((rows) => {
        setCommunities(rows)
      })
      .catch((err: any) => setError(err?.message || 'Could not load communities'))
      .finally(() => setLoading(false))
  }, [api, user, search])

  const active = communities.find((c) => c.id === selectedId) ?? null

  return (
    <div className="grid two" style={{ marginTop: 18 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('communities.title')}</h2>
          {loading && <span className="badge">{t('communities.loading')}</span>}
        </div>
        {error && <div className="badge negative">{error}</div>}
        {!loading && communities.length === 0 && <div className="empty">{t('communities.empty')}</div>}
        <input
          className="input"
          placeholder={t('be.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ margin: '10px 0' }}
        />
        <div className="list">
          {communities.map((c) => (
            <button
              key={c.id}
              className="list-item"
              onClick={() => setSelectedId(c.id)}
              style={{
                borderColor: active?.id === c.id ? 'rgba(43,212,213,0.6)' : undefined,
                background: active?.id === c.id ? 'rgba(43,212,213,0.08)' : undefined,
              }}
            >
              <div>
                <strong>{c.name}</strong>
                <div className="muted">{t('communities.code', { code: c.code })}</div>
              </div>
              {active?.id === c.id ? <span className="chip">{t('communities.selected')}</span> : <span className="badge">{t('communities.view')}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {active ? (
          <BillingExplorer community={active} />
        ) : (
          <div className="empty">Choose a community to inspect billing data.</div>
        )}
      </div>
    </div>
  )
}
