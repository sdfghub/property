import { SetMetadata } from '@nestjs/common'
export type ScopeSpec={ 
    role:'SYSTEM_ADMIN'|'COMMUNITY_ADMIN'|'BILLING_ENTITY_USER'|'CENSOR'; 
    scopeType?:'SYSTEM'|'COMMUNITY'|'BILLING_ENTITY'; 
    scopeParam?:string 
}
export const SCOPES_KEY='scopes_spec'
export const Scopes=(spec:ScopeSpec)=>SetMetadata(SCOPES_KEY,spec)
