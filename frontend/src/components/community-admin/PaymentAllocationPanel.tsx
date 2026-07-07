import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// Keep in sync with backend AllocationStrategy (src/modules/billing/payment-allocation.ts).
const STRATEGIES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'FIFO', label: 'Cronologic (FIFO)', hint: 'Cele mai vechi datorii se sting primele (comportament implicit).' },
  { key: 'LEGAL_PER_PERIOD', label: 'Legal — pe perioade', hint: 'Cea mai veche lună întâi; în cadrul fiecărei luni, penalizările înaintea principalului (Cod civil art. 1509).' },
  { key: 'LEGAL_PENALTIES_FIRST', label: 'Legal — penalizări întâi', hint: 'Toate penalizările (cele mai vechi întâi) înaintea oricărui principal.' },
  { key: 'FUND_PRIORITY', label: 'Ordine fonduri', hint: 'Fondurile se sting în ordinea de prioritate stabilită mai jos.' },
]

type Fund = { code: string; name: string }
type Config = { strategy: string; fundOrder?: string[]; funds: Fund[] }

export function PaymentAllocationPanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [cfg, setCfg] = React.useState<Config | null>(null)
  const [strategy, setStrategy] = React.useState<string>('FIFO')
  const [order, setOrder] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!communityId) return
    setCfg(null); setMsg(null); setError(null)
    api.get<Config>(`/communities/${communityId}/payment-allocation`)
      .then((c: Config) => {
        setCfg(c)
        setStrategy(c.strategy || 'FIFO')
        // Seed the priority list from stored order, appending any funds not yet listed.
        const codes = (c.funds || []).map((f: Fund) => f.code)
        const stored = (c.fundOrder || []).filter((x: string) => codes.includes(x))
        setOrder([...stored, ...codes.filter((x: string) => !stored.includes(x))])
      })
      .catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  function move(idx: number, dir: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev]
      const j = idx + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[idx], next[j]] = [next[j], next[idx]]
      return next
    })
  }

  async function save() {
    setBusy(true); setMsg(null); setError(null)
    try {
      const body: any = { strategy }
      if (strategy === 'FUND_PRIORITY') body.fundOrder = order
      const res = await api.post<Config>(`/communities/${communityId}/payment-allocation`, body)
      setStrategy(res.strategy)
      setMsg(t('alloc.saved', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  const fundName = (code: string) => cfg?.funds.find((f) => f.code === code)?.name || code

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('alloc.title', 'Repartizarea încasărilor pe datorii')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('alloc.hint', 'Cum se distribuie automat o încasare între taxele restante ale unui proprietar (când nu se aleg taxe manual).')}
      </div>
      {error && <div className="badge negative">{error}</div>}
      {!cfg ? <div className="empty">{t('common.loading', 'Loading…')}</div> : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="stack" style={{ gap: 4 }}>
            {STRATEGIES.map((s) => (
              <label key={s.key} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid var(--border,#eee)', cursor: 'pointer' }}>
                <input type="radio" name="alloc-strategy" checked={strategy === s.key} onChange={() => setStrategy(s.key)} style={{ marginTop: 3 }} />
                <div className="stack" style={{ gap: 0 }}>
                  <span>{s.label}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{s.hint}</span>
                </div>
              </label>
            ))}
          </div>

          {strategy === 'FUND_PRIORITY' && (
            <div className="stack" style={{ gap: 4 }}>
              <label className="label">{t('alloc.fundOrder', 'Ordinea fondurilor (primul = stins întâi)')}</label>
              {order.map((code, i) => (
                <div key={code} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 8px', border: '1px solid var(--border,#eee)', borderRadius: 6 }}>
                  <span><span className="muted" style={{ marginRight: 6 }}>{i + 1}.</span>{fundName(code)} <span className="muted" style={{ fontSize: 11 }}>({code})</span></span>
                  <span className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn small ghost" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="btn small ghost" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
            {msg && <span className="badge positive">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
