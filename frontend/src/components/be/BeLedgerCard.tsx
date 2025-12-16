import React from 'react'
import { groupAllocationsBySplit, groupByBucket, unitAllocationsForLedger } from './beHelpers'

type Props = {
  ledger: any[]
  allocations: any[]
  splitGroups: any[]
  splitGroupMembers: any[]
  splitNames?: Record<string, string> | null
}

export function BeLedgerCard({ ledger, allocations, splitGroups, splitGroupMembers, splitNames }: Props) {
  if (!ledger) return null
  return (
    <div className="card soft" style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4>Ledger</h4>
        <div className="badge">{ledger.length}</div>
      </div>
      {ledger.length === 0 ? (
        <div className="empty">No ledger entries</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Bucket</th>
              <th>Kind</th>
              <th>Ref</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((l: any) => (
              <React.Fragment key={l.id}>
                <tr>
                  <td>{l.bucket}</td>
                  <td>{l.kind}</td>
                  <td>
                    {l.refType || '-'} {l.refId ? `#${l.refId}` : ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {Number(l.amount).toFixed(2)} {l.currency}
                  </td>
                </tr>
                {Array.isArray(l.details) && l.details.length > 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {l.details.map((d: any, idx: number) => (
                        <span key={`${l.id}-d-${idx}`} style={{ marginRight: 12 }}>
                          {d.unit?.code || 'all'}: {Number(d.amount).toFixed(2)}
                        </span>
                      ))}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      <div className="stack" style={{ marginTop: 12 }}>
        <h4>Drill-down</h4>
        <div className="stack">
          {groupByBucket(ledger).map(([bucket, entries]) => (
            <div key={bucket} className="card soft">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{bucket}</strong>
                <div className="badge">{entries.length}</div>
              </div>
              <div className="stack" style={{ marginTop: 8 }}>
                {entries.map((le: any) => (
                  <div key={le.id} className="stack" style={{ padding: '6px 0', borderTop: '1px solid var(--muted-border, #eee)' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        {le.kind} {le.refType ? `· ${le.refType}` : ''}
                      </div>
                      <div className="muted">
                        {Number(le.amount).toFixed(2)} {le.currency}
                      </div>
                    </div>
                    <div className="stack" style={{ marginLeft: 8 }}>
                      {unitAllocationsForLedger(le, allocations).map(([unitCode, lines]) => (
                        <div key={`${le.id}-${unitCode}`} className="stack" style={{ marginLeft: 8 }}>
                          <div className="muted">{unitCode}</div>
                          {groupAllocationsBySplit(lines, splitGroups, splitGroupMembers, splitNames).map((g) => (
                            <div key={`${le.id}-${unitCode}-${g.name}`} className="stack" style={{ marginLeft: 8 }}>
                              <div>
                                <strong>{g.name}</strong>
                              </div>
                              <ul className="muted" style={{ margin: 0, paddingLeft: 12 }}>
                                {g.lines.map((ln) => (
                                  <li key={ln.allocation_id}>
                                    {ln.expense_description} — {ln.expense_type_code} — {Number(ln.amount).toFixed(2)} {ln.currency}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
