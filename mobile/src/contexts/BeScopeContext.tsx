import React from 'react'
import type { Community } from '@shared/api/types'
import { useAuth } from '@shared/auth/useAuth'

export type BeScopeValue = {
  selectedBeId: string | null
  setSelectedBeId: (id: string | null) => void
  shouldPrompt: boolean
  markPrompted: () => void
  communityMap: Record<string, Community>
  beMetaMap: Record<string, { name?: string; communityId?: string }>
  setBeMeta: (id: string, meta: { name?: string; communityId?: string }) => void
}

export const BeScopeContext = React.createContext<BeScopeValue | null>(null)

export function useBeScope() {
  const ctx = React.useContext(BeScopeContext)
  if (!ctx) throw new Error('useBeScope must be used within BeScopeProvider')
  return ctx
}

export function BeScopeProvider({ children }: { children: React.ReactNode }) {
  const { roles, activeRole, api } = useAuth()
  const beRoles = roles.filter((role) => role.scopeType === 'BILLING_ENTITY' && role.scopeId)
  const [selectedBeId, setSelectedBeId] = React.useState<string | null>(null)
  const [prompted, setPrompted] = React.useState(false)
  const [communityMap, setCommunityMap] = React.useState<Record<string, Community>>({})
  const [beMetaMap, setBeMetaMap] = React.useState<Record<string, { name?: string; communityId?: string }>>({})
  const fetchBeSummary = React.useCallback(
    async (id: string) => {
      if (!id) return
      try {
        const data = await api.get<{ id: string; code: string; name: string; communityId: string }>(`/communities/be/${id}/summary`)
        const label = data.name || data.code || data.id
        setBeMetaMap((prev) => ({
          ...prev,
          [id]: { name: label, communityId: data.communityId },
          [data.id]: { name: label, communityId: data.communityId },
        }))
      } catch {
        // ignore; fallback to id if not available
      }
    },
    [api],
  )

  React.useEffect(() => {
    if (selectedBeId || !beRoles.length) return
    if (activeRole?.scopeType === 'BILLING_ENTITY' && activeRole.scopeId) {
      setSelectedBeId(activeRole.scopeId)
      return
    }
    setSelectedBeId(beRoles[0].scopeId || null)
  }, [activeRole?.scopeId, activeRole?.scopeType, beRoles, selectedBeId])

  React.useEffect(() => {
    if (Object.keys(communityMap).length) return
    api
      .get<Community[]>('/communities')
      .then((rows) => {
        const next: Record<string, Community> = {}
        rows.forEach((row) => {
          next[row.id] = row
        })
        setCommunityMap(next)
      })
      .catch(() => {
        // leave as empty; labels will fall back to ids
      })
  }, [api, communityMap])

  React.useEffect(() => {
    if (!beRoles.length) return
    const missing = beRoles.map((r) => r.scopeId).filter((id) => id && !beMetaMap[id])
    if (!missing.length) return
    missing.forEach((id) => {
      if (id) void fetchBeSummary(id)
    })
  }, [beRoles, beMetaMap, fetchBeSummary])

  React.useEffect(() => {
    if (!selectedBeId || beMetaMap[selectedBeId]) return
    void fetchBeSummary(selectedBeId)
  }, [beMetaMap, fetchBeSummary, selectedBeId])

  const markPrompted = React.useCallback(() => setPrompted(true), [])
  const setBeMeta = React.useCallback((id: string, meta: { name?: string; communityId?: string }) => {
    setBeMetaMap((prev) => ({ ...prev, [id]: meta }))
  }, [])

  const value = React.useMemo(
    () => ({
      selectedBeId,
      setSelectedBeId,
      shouldPrompt: !prompted && beRoles.length > 1,
      markPrompted,
      communityMap,
      beMetaMap,
      setBeMeta,
    }),
    [selectedBeId, beRoles.length, prompted, communityMap, beMetaMap, markPrompted, setBeMeta],
  )

  return <BeScopeContext.Provider value={value}>{children}</BeScopeContext.Provider>
}
