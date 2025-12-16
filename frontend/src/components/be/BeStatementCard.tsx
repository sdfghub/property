import React from 'react'

export function BeStatementCard({ statement }: { statement: any }) {
  if (!statement) return null
  return (
    <div className="card soft" style={{ marginTop: 12 }}>
      <h4>Statement</h4>
      <div className="grid four">
        <Stat label="Opening" value={statement.dueStart} />
        <Stat label="Charges" value={statement.charges} />
        <Stat label="Payments" value={statement.payments} />
        <Stat label="Adjustments" value={statement.adjustments} />
      </div>
      <div className="badge primary" style={{ marginTop: 8 }}>
        Due: {Number(statement.dueEnd ?? 0).toFixed(2)} {statement.currency || 'RON'}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="stack">
      <div className="muted">{label}</div>
      <div>
        <strong>{Number(value ?? 0).toFixed(2)}</strong>
      </div>
    </div>
  )
}
