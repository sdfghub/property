// API client shared between web and mobile apps.
// It is platform-agnostic: base URL is injected by the caller.
type TokenBundle = { accessToken?: string; refreshToken?: string }

export type ApiClientConfig = {
  baseUrl: string
  getTokens: () => TokenBundle
  saveTokens: (tokens: Partial<TokenBundle>) => void
  onUnauthorized?: () => void
}

export type ApiClient = {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  del: <T>(path: string) => Promise<T>
  deleteWithBody: <T>(path: string, body?: unknown) => Promise<T>
  refreshAccessToken: () => Promise<string | null>
}

function urlFor(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function buildError(res: Response, body: any) {
  const message = typeof body === 'string' ? body : body?.message || res.statusText
  return new Error(`Request failed (${res.status}): ${message}`)
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl

  // Helper to refresh using stored refresh token.
  // Called automatically from `request` when we hit a 401 once.
  async function refreshAccessToken(): Promise<string | null> {
    const { refreshToken } = config.getTokens()
    const res = await fetch(urlFor(baseUrl, '/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: refreshToken ? { 'Content-Type': 'application/json' } : undefined,
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    })
    if (!res.ok) {
      config.onUnauthorized?.()
      return null
    }
    const data = await res.json()
    if (data?.accessToken) config.saveTokens({ accessToken: data.accessToken })
    return data?.accessToken ?? null
  }

  // Core requester: injects auth header, auto-retries once on 401 via refresh.
  async function request<T>(path: string, init: RequestInit = {}, attemptRefresh = true): Promise<T> {
    const tokens = config.getTokens()
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    }
    if (tokens.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    if (!isFormData && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(urlFor(baseUrl, path), {
      ...init,
      headers,
      body: init.body
        ? isFormData
          ? (init.body as BodyInit)
          : typeof init.body === 'string'
          ? init.body
          : JSON.stringify(init.body)
        : undefined,
    })

    if (res.status === 401 && attemptRefresh) {
      const refreshed = await refreshAccessToken()
      if (refreshed) {
        return request<T>(path, init, false)
      }
      config.onUnauthorized?.()
      throw new Error('Session expired, please sign in again')
    }

    const text = await res.text()
    const maybeJson = text ? safeJson(text) : null

    if (!res.ok) {
      throw buildError(res, maybeJson ?? text)
    }

    // Avoid JSON parsing errors on empty responses; endpoints may return 204.
    return (maybeJson as T) ?? ({} as T)
  }

  return {
    get: <T>(path: string) => request<T>(path, { method: 'GET' }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    deleteWithBody: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
    refreshAccessToken,
  }
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
