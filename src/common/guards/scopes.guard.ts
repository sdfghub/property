import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SCOPES_KEY, ScopeSpec } from '../decorators/scopes.decorator'
type RoleAssignment={ role:string; scopeType:string; scopeId?:string|null }
@Injectable()
export class ScopesGuard implements CanActivate{
  constructor(private readonly reflector:Reflector){}
  canActivate(ctx:ExecutionContext):boolean{
    const spec=this.reflector.get<ScopeSpec>(SCOPES_KEY,ctx.getHandler())
    if(!spec) return true
    const req=ctx.switchToHttp().getRequest()
    const user=req.user as { sub:string; email:string; roles:RoleAssignment[]; token_version?:number }
    if(!user) throw new ForbiddenException('No user in context')
    // Optional: DB token_version check can be added in a middleware; here we assume JwtStrategy added it.
    const relevant=user.roles.filter(r=>r.role===spec.role)
    if(!relevant.length) throw new ForbiddenException('Missing role')
    if(!spec.scopeType || spec.scopeType==='SYSTEM') return true
    const scopeId=spec.scopeParam? String(req.params?.[spec.scopeParam]) : undefined
    if(!scopeId) throw new ForbiddenException(`Missing scope param: ${spec.scopeParam}`)
    const ok=relevant.some(r=>r.scopeType===spec.scopeType && (r.scopeId===scopeId))
    if(!ok) throw new ForbiddenException('Insufficient scope')
    return true
  }
}
