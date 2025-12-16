import React from 'react'

export function BeAllocationsTable({ allocations }: { allocations: any[] }) {
  if (!allocations) return null
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4>Expenses / allocations</h4>
        <div className="badge">{allocations.length}</div>
      </div>
      {allocations.length === 0 ? (
        <div className="empty">No allocations</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Expense</th>
              <th>Type</th>
              <th>Unit</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((l: any) => (
              <tr key={l.allocation_id}>
                <td>{l.expense_description}</td>
                <td>{l.expense_type_code}</td>
                <td>{l.unit_code}</td>
                <td style={{ textAlign: 'right' }}>
                  {Number(l.amount).toFixed(2)} {l.currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
