import { JwtModuleAsyncOptions } from '@nestjs/jwt'
export const jwtModuleOptions:JwtModuleAsyncOptions={
  useFactory:async()=>({ secret:process.env.JWT_ACCESS_SECRET||'dev_access_secret', signOptions:{expiresIn:process.env.JWT_ACCESS_TTL||'900s'} })
}
