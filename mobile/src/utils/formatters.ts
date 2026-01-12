import type { Community } from '@shared/api/types'

export function formatDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString()
}

export function formatMoney(value: any, currency?: string) {
  const numeric = Number(value || 0)
  if (Number.isNaN(numeric)) return String(value ?? '')
  return `${numeric.toFixed(2)} ${currency || 'RON'}`
}

export function formatVoteSummary(poll: any) {
  if (!poll?.userVoteOptionIds || !Array.isArray(poll.userVoteOptionIds)) return '—'
  const ids = new Set(poll.userVoteOptionIds)
  const options = Array.isArray(poll.options) ? poll.options : []
  const labels = options.filter((opt: any) => ids.has(opt.id)).map((opt: any) => opt.text)
  return labels.length ? labels.join(', ') : '—'
}

export function formatChannelLabel(channel: string) {
  if (channel === 'IN_APP') return 'In-app'
  if (channel === 'PUSH') return 'Push'
  if (channel === 'EMAIL') return 'Email'
  return channel
}

export function getBeLabel(
  beId: string,
  beMetaMap: Record<string, { name?: string; communityId?: string }>,
  communityMap: Record<string, Community>,
) {
  if (!beId) return ''
  const meta = beMetaMap[beId]
  if (!meta) return beId
  const communityName = meta.communityId ? communityMap[meta.communityId]?.name : undefined
  return communityName ? `${communityName} · ${meta.name || beId}` : meta.name || beId
}
