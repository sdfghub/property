import { useI18n } from '../../i18n/useI18n'
import { money } from './money-utils'

export type ReceiptData = {
  kind: 'IN' | 'OUT'
  number: string
  date: string
  party: string
  amount: number
  currency: string
  method?: string
  accountName?: string
  communityName?: string
  lines?: Array<{ label: string; amount: number }>
}

function buildHtml(r: ReceiptData, labels: Record<string, string>): string {
  const rows = (r.lines || [])
    .map((l) => `<tr><td>${l.label}</td><td style="text-align:right">${money(l.amount, r.currency)}</td></tr>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${r.number}</title>
  <style>
    body{font-family:system-ui,Arial,sans-serif;color:#111;max-width:520px;margin:24px auto;padding:0 16px}
    h1{font-size:18px;margin:0 0 2px} .muted{color:#666;font-size:12px}
    table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}
    td{padding:4px 0;border-bottom:1px solid #eee}
    .tot{font-weight:700;font-size:16px;margin-top:12px;display:flex;justify-content:space-between}
    .foot{margin-top:24px;color:#888;font-size:11px}
  </style></head><body>
  <h1>${labels.title}</h1>
  <div class="muted">${r.communityName || ''} · ${labels.no} ${r.number} · ${r.date}</div>
  <div style="margin-top:12px"><strong>${labels.party}:</strong> ${r.party}</div>
  <div class="muted">${r.method ? labels.method + ': ' + r.method + ' · ' : ''}${r.accountName ? labels.account + ': ' + r.accountName : ''}</div>
  ${rows ? `<table><tbody>${rows}</tbody></table>` : ''}
  <div class="tot"><span>${labels.total}</span><span>${money(r.amount, r.currency)}</span></div>
  <div class="foot">${labels.disclaimer}</div>
  </body></html>`
}

export function ReceiptPrintView({ data }: { data: ReceiptData }) {
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const labels = {
    title: data.kind === 'IN' ? t('receipt.docTitle', 'CHITANȚĂ (încasare)') : t('receipt.docTitleOut', 'DISPOZIȚIE DE PLATĂ'),
    no: t('receipt.no', 'nr.'),
    party: data.kind === 'IN' ? t('receipt.from', 'De la') : t('paybill.vendor', 'Furnizor'),
    method: t('receipt.method', 'Metodă'),
    account: t('receipt.account', 'Cont'),
    total: t('receipt.total', 'Total'),
    disclaimer: t('receipt.disclaimer', 'Document informativ, fără serie/număr fiscal.'),
  }

  function print() {
    const w = window.open('', '_blank', 'width=560,height=700')
    if (!w) return
    w.document.write(buildHtml(data, labels))
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <div className="card soft" style={{ marginTop: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{labels.title}</strong>
        <button type="button" className="btn secondary small" onClick={print}>🖨 {t('receipt.print', 'Tipărește')}</button>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{labels.no} {data.number} · {data.date}</div>
      <div style={{ marginTop: 4 }}>{labels.party}: <strong>{data.party}</strong></div>
      {(data.lines || []).length > 0 && (
        <ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
          {data.lines!.map((l, i) => (
            <li key={i} style={{ fontVariantNumeric: 'tabular-nums' }}>{l.label}: {money(l.amount, data.currency)}</li>
          ))}
        </ul>
      )}
      <div className="row" style={{ justifyContent: 'flex-end', fontWeight: 700, marginTop: 6 }}>
        {labels.total}: {money(data.amount, data.currency)}
      </div>
    </div>
  )
}
