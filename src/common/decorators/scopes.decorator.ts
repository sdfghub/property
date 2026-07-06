import { SetMetadata } from '@nestjs/common'

export type ScopeRole =
  | 'SYSTEM_ADMIN'
  | 'COMMUNITY_ADMIN'
  | 'BILLING_ENTITY_USER'
  | 'CENSOR'
  | 'EXECUTIVE_COMITEE_MEMBER'

export type ScopeSpec = {
  /** A single allowed role, or a list of roles any of which grants access. SYSTEM_ADMIN always passes. */
  role: ScopeRole | ScopeRole[]
  scopeType?: 'SYSTEM' | 'COMMUNITY' | 'BILLING_ENTITY'
  /** Name of the route param holding the scope id (e.g. 'communityId'). */
  scopeParam?: string
}

export const SCOPES_KEY = 'scopes_spec'
export const Scopes = (spec: ScopeSpec) => SetMetadata(SCOPES_KEY, spec)
