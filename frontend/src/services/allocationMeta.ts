// A minimal formatter for allocation_line.meta plus splitTrail entries coming from the be-financials endpoints.
export type AllocationBasis = {
  type?: string
  code?: string
}

export type AllocationDetails = {
  method?: string
  basis?: AllocationBasis
  weightSource?: string
}

export type DerivedShare = {
  meterType?: string
  totalMeterId?: string
  partMeterId?: string
}

export type SplitNodeMeta = {
  id?: string
  name?: string
  allocation?: AllocationDetails
  derivedShare?: DerivedShare
}

export type AllocationMeta = {
  splitNode?: SplitNodeMeta
  allocation?: AllocationDetails
  basis?: AllocationBasis
  weightSource?: string
  splitTrail?: Array<{ id?: string; name?: string; meta?: unknown }>
  [key: string]: unknown
}

// Produces a verbose, human-friendly description from allocation_line.meta
export function formatAllocationMeta(meta?: AllocationMeta, t?: (key: string, params?: any) => string): string {
  if (!meta || typeof meta !== 'object') return ''
  const parts: string[] = []

  const label = (key: string) => (t ? t(key) : key)

  const baseSplit = meta.splitNode
  if (baseSplit?.name) parts.push(`${label('meta.split')}: ${baseSplit.name}`)
  if (baseSplit?.allocation?.method) {
    const method = baseSplit.allocation.method
    const basis = baseSplit.allocation.basis
    const weight = baseSplit.allocation.weightSource
    parts.push(`${label('meta.method')}: ${t ? t(`alloc.${method}`) : method}`)
    if (basis?.type) parts.push(`${label('meta.basis')}: ${basis.type}${basis.code ? `:${basis.code}` : ''}`)
    if (weight) parts.push(`${label('meta.weight')}: ${weight}`)
  }
  if (baseSplit?.derivedShare?.meterType) {
    const d = baseSplit.derivedShare
    const tot = d.totalMeterId ? `/${d.totalMeterId}` : ''
    const part = d.partMeterId ? ` part=${d.partMeterId}` : ''
    parts.push(`${label('meta.derived')}: ${d.meterType}${tot}${part}`)
  }

  if (meta.weightSource) {
    parts.push(`${label('meta.weight')}: ${meta.weightSource}`)
  }

  if (meta.splitTrail && Array.isArray(meta.splitTrail) && meta.splitTrail.length > 0) {
    const trailNames = meta.splitTrail.map((t) => t.name || t.id).filter(Boolean)
    if (trailNames.length) parts.push(`${label('meta.trail')}: ${trailNames.join(' > ')}`)
  }

  const measures: string[] = []
  if (typeof (meta as any).totalMeasure === 'number') measures.push(`${label('meta.total')}: ${(meta as any).totalMeasure}`)
  if (typeof (meta as any).unitMeasure === 'number') measures.push(`${label('meta.unit')}: ${(meta as any).unitMeasure}`)
  if (typeof (meta as any).weight === 'number') measures.push(`${label('meta.weight')}: ${(meta as any).weight}`)
  if (measures.length) parts.push(measures.join(' | '))

  return parts.join(' · ')
}
