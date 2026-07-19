import React from 'react'
import { useAuth } from './useAuth'

// Fixed system taxonomies (codes + labels/hints) served by the backend metadata endpoint,
// so components never hardcode domain code→label knowledge.
export type EnumMeta = { key: string; label: string; hint?: string; tone?: string }
export type CommunityMetadata = {
  roles: EnumMeta[]
  governanceRoles: EnumMeta[]
  beRoles: EnumMeta[]
  notificationChannels: EnumMeta[]
  committeeDecisionStatuses: EnumMeta[]
  impactTags: EnumMeta[]
  audienceTypes: EnumMeta[]
  meterModes: EnumMeta[]
  waterMethods: EnumMeta[]
}

export const labelOf = (list: EnumMeta[] | undefined, key: string): string =>
  list?.find((m) => m.key === key)?.label ?? key

// The taxonomies are global/static, so this fetches once from the top-level /metadata route.
export function useMetadata(): CommunityMetadata | null {
  const { api } = useAuth()
  const [meta, setMeta] = React.useState<CommunityMetadata | null>(null)
  React.useEffect(() => {
    api.get<CommunityMetadata>(`/metadata`)
      .then((m: CommunityMetadata) => setMeta(m))
      .catch(() => setMeta(null))
  }, [api])
  return meta
}
