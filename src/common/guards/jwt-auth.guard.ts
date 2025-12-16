import { Injectable } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'

// Temporary relaxed guard: always allow and return an empty user object when missing.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  async canActivate(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest(_err: any, user: any) {
    return user || {}
  }
}
