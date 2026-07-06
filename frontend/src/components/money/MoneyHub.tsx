import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { DebtorsPanel } from './DebtorsPanel'
import { UnpaidInvoicesPanel } from './UnpaidInvoicesPanel'
import { RecordReceiptModal } from './RecordReceiptModal'
import { PayBillModal } from './PayBillModal'
import { money } from './money-utils'

type BE = { id: string; code?: string; name?: string }

export function MoneyHub({
  communityId,
  communityCode,
  communityName,
  billingEntities,
}: {
  communityId: string
  communityCode: string
  communityName?: string
  billingEntities: BE[]
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [showReceipt, setShowReceipt] = React.useState(false)
  const [showBill, setShowBill] = React.useState(false)
  const [preBe, setPreBe] = React.useState<string | undefined>()
  const [preInvoice, setPreInvoice] = React.useState<string | undefined>()
  const [reloadKey, setReloadKey] = React.useState(0)
  const [recent, setRecent] = React.useState<any[]>([])

  const loadRecent = React.useCallback(() => {
    api.get<any[]>(`/communities/${communityId}/payments`)
      .then((rows) => setRecent((Array.isArray(rows) ? rows : []).slice(0, 6)))
      .catch(() => setRecent([]))
  }, [api, communityId])

  React.useEffect(() => { if (communityId) loadRecent() }, [communityId, loadRecent, reloadKey])

  const refetchAll = () => setReloadKey((k) => k + 1)

  const openReceiptFor = (beCode?: string) => {
    const be = billingEntities.find((b) => b.code === beCode)
    setPreBe(be?.id)
    setShowReceipt(true)
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" type="button" onClick={() => { setPreBe(undefined); setShowReceipt(true) }}>
          + {t('money.recordReceipt', 'Încasare')}
        </button>
        <button className="btn secondary" type="button" onClick={() => { setPreInvoice(undefined); setShowBill(true) }}>
          + {t('money.payBill', 'Plată furnizor')}
        </button>
      </div>

      <div className="grid two" style={{ gap: 16 }}>
        <div className="stack" style={{ gap: 8 }}>
          <h4 style={{ margin: 0 }}>{t('money.moneyIn', 'Încasări · datornici')}</h4>
          <DebtorsPanel key={`d${reloadKey}`} communityId={communityId} onPick={(d: any) => openReceiptFor(d.beCode)} />
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <h4 style={{ margin: 0 }}>{t('money.moneyOut', 'Plăți · facturi furnizori')}</h4>
          <UnpaidInvoicesPanel key={`u${reloadKey}`} communityId={communityId} onPick={(inv: any) => { setPreInvoice(inv.id); setShowBill(true) }} />
        </div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>{t('money.recent', 'Încasări recente')}</h4>
        {recent.length ? (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            {recent.map((p) => (
              <li key={p.id} style={{ fontVariantNumeric: 'tabular-nums' }}>
                +{money(p.amount, p.currency)} · {p.billingEntityName || p.billingEntityCode || p.billingEntityId}
                {p.ts ? ` · ${new Date(p.ts).toLocaleDateString('ro-RO')}` : ''}
              </li>
            ))}
          </ul>
        ) : <div className="empty">{t('payments.empty', 'Nicio încasare încă')}</div>}
      </div>

      <RecordReceiptModal
        communityId={communityId}
        communityCode={communityCode}
        communityName={communityName}
        billingEntities={billingEntities}
        preselectBeId={preBe}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        onDone={refetchAll}
      />
      <PayBillModal
        communityId={communityId}
        communityCode={communityCode}
        communityName={communityName}
        preselectInvoiceId={preInvoice}
        open={showBill}
        onClose={() => setShowBill(false)}
        onDone={refetchAll}
      />
    </div>
  )
}
