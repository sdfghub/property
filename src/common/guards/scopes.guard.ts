import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SCOPES_KEY, ScopeSpec, ScopeRole } from '../decorators/scopes.decorator'

type UserRole = { role: string; scopeType: string; scopeId?: string | null }

/**
 * Enforces the @Scopes({ role, scopeType, scopeParam }) metadata against the JWT user's roles.
 * - Endpoints with no @Scopes metadata are allowed (backward compatible).
 * - SYSTEM_ADMIN always passes.
 * - Otherwise the user must hold one of the allowed roles at the matching scope: for a
 *   COMMUNITY/BILLING_ENTITY scope the role's scopeId must equal the route param named by
 *   scopeParam; for a SYSTEM scope the role's scopeType must be SYSTEM.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const spec = this.reflector.getAllAndOverride<ScopeSpec | undefined>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (!spec) return true // no scope declared → not enforced

    const req = ctx.switchToHttp().getRequest()
    const roles: UserRole[] = Array.isArray(req?.user?.roles) ? req.user.roles : []

    // "Act as" least-privilege: if the client declares an active role (and the user actually
    // holds it), the request is evaluated against ONLY that role — never an escalation, since
    // we intersect with the roles in the JWT. A stale/forged header falls back to the full set.
    const header = (name: string): string | undefined => {
      const v = req?.headers?.[name]
      const s = Array.isArray(v) ? v[0] : v
      return s ? String(s) : undefined
    }
    const activeName = header('x-active-role')
    let effective: UserRole[] = roles
    if (activeName) {
      const activeScopeType = header('x-active-scope-type')
      const activeScopeId = header('x-active-scope-id') ?? ''
      const matched = roles.filter(
        (r) =>
          r.role === activeName &&
          (!activeScopeType || r.scopeType === activeScopeType) &&
          (r.scopeId ?? '') === activeScopeId,
      )
      if (matched.length) effective = matched
    }

    // SYSTEM_ADMIN bypasses all scope checks — but only if acting as system admin.
    if (effective.some((r) => r.role === 'SYSTEM_ADMIN')) return true

    const allowed: ScopeRole[] = Array.isArray(spec.role) ? spec.role : [spec.role]
    const scopeType = spec.scopeType
    const scopeValue = spec.scopeParam ? req?.params?.[spec.scopeParam] : undefined

    const ok = effective.some((r) => {
      if (!allowed.includes(r.role as ScopeRole)) return false
      if (!scopeType) return true
      if (r.scopeType !== scopeType) return false
      if (scopeType === 'SYSTEM') return true
      // COMMUNITY / BILLING_ENTITY: the role must be scoped to this exact target
      return scopeValue != null && r.scopeId === scopeValue
    })

    if (!ok) throw new ForbiddenException('Insufficient role for this action')
    return true
  }
}
