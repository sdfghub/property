import React from 'react'
import { formatAllocationMeta } from '../../services/allocationMeta'
import { useI18n } from '../../i18n/useI18n'

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
  meta?: unknown
  splitTrail?: Array<{ id?: string; name?: string; meta?: unknown }>
}

export function BeAllocationDetailTable({ title, lines }: { title?: string | null; lines: Detail[] }) {
  const { t } = useI18n()

  const renderDisplay = (meta: any) => {
    if (!meta) return ''
    if (meta.displayKey) return t(meta.displayKey, meta.displayParams || {})
    if (typeof meta.display === 'string') return meta.display
    return ''
  }

  const renderParams = (meta: any) => {
    const params = meta?.displayParams
    if (!params || typeof params !== 'object') return ''
    const entries = Object.entries(params)
    if (!entries.length) return ''
    return entries
      .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : String(v)}`)
      .join(' · ')
  }
  
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
              {ln.meta && (
                <tr>
                  <td colSpan={4} className="muted" style={{ fontSize: 11 }}>
                    {renderDisplay(ln.meta)}
                    {renderParams(ln.meta) ? (
                      <div style={{ marginTop: 2 }}>{renderParams(ln.meta)}</div>
                    ) : null}
                  </td>
                </tr>
              )}
              {Array.isArray(ln.splitTrail) && ln.splitTrail.length > 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="stack" style={{ gap: 4, fontSize: 11 }}>
                      {ln.splitTrail.map((trail, idx) => (
                        <div key={trail.id || idx} style={{ paddingLeft: `${idx * 12}px` }}>
                          <div>{trail.name || trail.id || '—'}</div>
                          {trail.meta && (
                            <div className="muted" style={{ marginLeft: 8 }}>
                              {renderDisplay(trail.meta)}
                              {renderParams(trail.meta) ? <div>{renderParams(trail.meta)}</div> : null}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
