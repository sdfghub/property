import { createApiClient as createSharedApiClient } from '@shared/api/client'
import type { ApiClient, ApiClientConfig } from '@shared/api/client'

// Base URL used by the API client; defaults to same-origin /api.
// Vite env overrides via VITE_API_BASE or VITE_API_BASE_URL. Trailing slash is trimmed.
export const API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_BASE || import.meta.env?.VITE_API_BASE_URL)) ||
  (typeof window !== 'undefined' ? `${window.location.origin}/api` : 'http://localhost:3000/api')

export type { ApiClient }

export function createApiClient(config: ApiClientConfig): ApiClient {
  return createSharedApiClient({ ...config, baseUrl: API_BASE })
}
