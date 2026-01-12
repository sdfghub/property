import React from 'react'

type Detail = {
  allocationId?: string
  expenseDescription?: string
  expenseId?: string
  splitNodeName?: string
  splitGroupName?: string
  splitGroupCode?: string
  unitName?: string
  unitCode?: string
  amount?: number | string
  allocationTrace?: any
  splitTrailPhrases?: string[]
  splitTrail?: Array<{
    id?: string
    name?: string
    splitId?: string
    share?: number
    amount?: number
    basis?: { type?: string; code?: string }
    derivedShare?: string | null
    allocation?: {
      method?: string | null
      ruleCode?: string | null
      basis?: { type?: string; code?: string } | null
      weightSource?: string | null
    } | null
  }>
}

export function BeAllocationDetailTable({ title, lines }: { title?: string | null; lines: Detail[] }) {
  
  if (!lines || lines.length === 0) return null
  return (
    <div className="stack" style={{ marginTop: 6, gap: 4 }}>
      <table className="table muted" style={{ margin: 0, fontSize: 12 }}>
        <tbody>
          {lines.map((ln: Detail, i: number) => (
            <React.Fragment key={ln.allocationId || i}>
              <tr>
                <td>{ln.splitNodeName || ln.splitGroupName || ln.splitGroupCode || '—'}</td>
                <td>{ln.unitName || ln.unitCode || '—'}</td>
                <td style={{ textAlign: 'right' }}>{Number(ln.amount || 0).toFixed(2)}</td>
              </tr>
              {Array.isArray(ln.splitTrailPhrases) && ln.splitTrailPhrases.length > 0 ? (
                <tr>
                  <td colSpan={4} className="muted" style={{ fontSize: 11 }}>
                    <div className="stack" style={{ gap: 4 }}>
                      {ln.splitTrailPhrases.map((phrase, idx) => (
                        <div key={`${ln.allocationId || i}-phrase-${idx}`} style={{ paddingLeft: idx * 8 }}>
                          {phrase}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ) : null}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
