import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

// Temporary relaxed scopes guard: always allow.
@Injectable()
export class ScopesGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true
  }
}
