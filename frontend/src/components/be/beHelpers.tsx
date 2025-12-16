export function groupByBucket(ledger: any[]): [string, any[]][] {
  const map = new Map<string, any[]>()
  ledger.forEach((le) => {
    const b = le.bucket || 'UNKNOWN'
    const list = map.get(b) ?? []
    list.push(le)
    map.set(b, list)
  })
  return Array.from(map.entries())
}

export function unitAllocationsForLedger(ledgerEntry: any, allocations: any[]): [string, any[]][] {
  const unitCodes = new Set<string>()
  ;(ledgerEntry.details || []).forEach((d: any) => {
    if (d.unit?.code) unitCodes.add(d.unit.code)
  })
  const relevant = allocations.filter((a) => unitCodes.has(a.unit_code))
  const grouped = new Map<string, any[]>()
  relevant.forEach((a) => {
    const key = a.unit_code
    const list = grouped.get(key) ?? []
    list.push(a)
    grouped.set(key, list)
  })
  return Array.from(grouped.entries())
}

export function makeSplitNameMap(splitGroups: any[], splitGroupMembers: any[], splitNames: Record<string, string> | null) {
  const nameByNode = new Map<string, string>()
  if (splitNames) {
    Object.entries(splitNames).forEach(([k, v]) => nameByNode.set(k, v))
  }
  splitGroups.forEach((g) => {
    splitGroupMembers
      .filter((m: any) => m.splitGroupId === g.id)
      .forEach((m: any) => nameByNode.set(m.splitNodeId, g.name || g.code))
  })
  return nameByNode
}

export function groupAllocationsBySplit(
  lines: any[],
  splitGroups: any[],
  splitGroupMembers: any[],
  splitNames?: Record<string, string> | null,
) {
  const nameByNode = makeSplitNameMap(splitGroups, splitGroupMembers, splitNames || null)
  const grouped = new Map<string, any[]>()
  lines.forEach((l) => {
    const name = l.split_name || nameByNode.get(l.split_node_id) || l.split_node_id
    const list = grouped.get(name) ?? []
    list.push(l)
    grouped.set(name, list)
  })
  return Array.from(grouped.entries()).map(([name, ls]) => ({ name, lines: ls }))
}

export function renderGroupBreakdown(
  unitCode: string,
  allocations: any[] | null,
  splitGroups: any[],
  splitGroupMembers: any[],
  splitNames?: Record<string, string> | null,
) {
  if (!allocations) return <span className="muted">–</span>
  const nodeToGroup = new Map<string, string>()
  splitGroups.forEach((g) => {
    splitGroupMembers
      .filter((m: any) => m.splitGroupId === g.id)
      .forEach((m: any) => nodeToGroup.set(m.splitNodeId, g.name || g.code))
  })
  const nameByNode = makeSplitNameMap(splitGroups, splitGroupMembers, splitNames || null)
  const filtered = allocations.filter((a) => a.unit_code === unitCode && Number(a.amount || 0) !== 0)
  if (!filtered.length) return <span className="muted">–</span>

  const grouped = new Map<string, { total: number; splits: Map<string, number> }>()
  filtered.forEach((a) => {
    const group = nodeToGroup.get(a.split_node_id) || a.split_node_id
    const splitLabel = a.split_name || nameByNode.get(a.split_node_id) || a.split_node_id || a.split_node_id
    const g = grouped.get(group) ?? { total: 0, splits: new Map() }
    g.total += Number(a.amount || 0)
    g.splits.set(splitLabel, (g.splits.get(splitLabel) ?? 0) + Number(a.amount || 0))
    grouped.set(group, g)
  })

  return (
    <div className="stack" style={{ gap: 6 }}>
      {Array.from(grouped.entries()).map(([gName, data]) => (
        <div key={`${unitCode}-${gName}`} className="muted">
          <div>
            <strong>{gName}</strong>: {data.total.toFixed(2)}
          </div>
          {Array.from(data.splits.entries()).length > 1 && (
            <ul className="muted" style={{ margin: '2px 0 0 0', paddingLeft: 42 }}>
              {Array.from(data.splits.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([splitLabel, amt]) => (
                  <li key={`${unitCode}-${gName}-${splitLabel}`}>
                    {splitLabel}: {amt.toFixed(2)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
