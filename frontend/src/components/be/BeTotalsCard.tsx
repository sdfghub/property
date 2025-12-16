import React from 'react'
import { renderGroupBreakdown } from './beHelpers'

type Totals = {
  total: number
  perUnit: Array<{ unit: string; amount: number }>
  perUnitSplit?: Record<string, Array<{ split: string; amount: number }>>
}

type Props = {
  totals: Totals
  allocations: any[] | null
  splitGroups: any[]
  splitGroupMembers: any[]
  splitNames?: Record<string, string> | null
}

export function BeTotalsCard({ totals, allocations, splitGroups, splitGroupMembers, splitNames }: Props) {
  if (!totals) return null
  return (
    <div className="card soft" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4>Total allocations</h4>
        <div className="badge">{totals.perUnit.length} units</div>
      </div>
      <div className="pill primary" style={{ marginTop: 6 }}>
        Total: {totals.total.toFixed(2)}
      </div>
      <table className="table" style={{ marginTop: 10 }}>
        <thead>
          <tr>
            <th>Unit</th>
            <th style={{ textAlign: 'right' }}>Amount</th>
            <th>Split groups</th>
          </tr>
        </thead>
        <tbody>
          {totals.perUnit.map((u) => (
            <tr key={`total-${u.unit}`}>
              <td>{u.unit}</td>
              <td style={{ textAlign: 'right' }}>{u.amount.toFixed(2)}</td>
              <td>{renderGroupBreakdown(u.unit, allocations, splitGroups, splitGroupMembers, splitNames)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
