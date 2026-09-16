import React from 'react'
import { useAuth } from '../hooks/useAuth'

export type PeriodSummary = { id: string; code: string; seq: number; status: string; closedAt?: string | null; startDate?: string | null; afisareDate?: string | null; dueDate?: string | null }

type PeriodContextValue = {
  periods: PeriodSummary[]
  selectedCode: string
  selectedPeriod: PeriodSummary | null
  setSelectedCode: (code: string) => void
  loading: boolean
  refresh: () => Promise<void>
}

const PeriodContext = React.createContext<PeriodContextValue | null>(null)

// Single source of truth for "which period is the admin browsing right now" — shared by every
// tab (Avizier, Contoare, Overview, Dashboard) instead of each keeping its own local selection.
export function PeriodProvider({ communityId, children }: { communityId: string; children: React.ReactNode }) {
  const { api } = useAuth()
  const [periods, setPeriods] = React.useState<PeriodSummary[]>([])
  const [selectedCode, setSelectedCode] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const seededFor = React.useRef<string | null>(null)

  const loadPeriods = React.useCallback(() => {
    if (!communityId) return Promise.resolve()
    return api
      .get<PeriodSummary[]>(`/communities/${communityId}/periods`)
      .then((rows: PeriodSummary[]) => setPeriods(Array.isArray(rows) ? rows : []))
      .catch(() => setPeriods([]))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    setLoading(true)
    loadPeriods().finally(() => setLoading(false))
  }, [communityId, loadPeriods])

  // Seed the initial selection once per community from the true "current" (editable) period —
  // matches the existing "default to current month" behavior admins already expect.
  React.useEffect(() => {
    if (!communityId || seededFor.current === communityId) return
    seededFor.current = communityId
    api
      .get<any>(`/communities/${communityId}/periods/editable`)
      .then((res: any) => {
        if (res?.period?.code) setSelectedCode(res.period.code)
      })
      .catch(() => {})
  }, [api, communityId])

  // Fall back to the newest known period if nothing got seeded (e.g. the editable fetch failed).
  React.useEffect(() => {
    if (selectedCode || !periods.length) return
    const newest = periods.slice().sort((a, b) => b.seq - a.seq)[0]
    if (newest) setSelectedCode(newest.code)
  }, [periods, selectedCode])

  const selectedPeriod = periods.find((p) => p.code === selectedCode) ?? null

  const value: PeriodContextValue = {
    periods,
    selectedCode,
    selectedPeriod,
    setSelectedCode,
    loading,
    refresh: loadPeriods,
  }

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

export function usePeriod(): PeriodContextValue {
  const ctx = React.useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod must be used within a PeriodProvider')
  return ctx
}

// Non-throwing variant for components that may render either inside the shared admin dashboard
// (wrapped in PeriodProvider) or standalone (e.g. a resident read-only embed) — null outside a provider.
export function usePeriodOptional(): PeriodContextValue | null {
  return React.useContext(PeriodContext)
}
