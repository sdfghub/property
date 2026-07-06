import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type Account = { id: string; code: string; name: string; type: string; currency?: string }

/**
 * Cash/bank account picker. Auto-seeds a default "Casă" (PETTY) + "Bancă" (BANK)
 * when the community has none, so a payment can always post a CashTx.
 */
export function CashAccountSelect({
  communityId,
  value,
  onChange,
}: {
  communityId: string
  value: string
  onChange: (accountId: string, account?: Account) => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [accounts, setAccounts] = React.useState<Account[]>([])
  const [loading, setLoading] = React.useState(true)
  const [seeding, setSeeding] = React.useState(false)
  const [showCreate, setShowCreate] = React.useState(false)
  const [draft, setDraft] = React.useState({ name: '', type: 'PETTY' })
  const seededRef = React.useRef(false)

  const load = React.useCallback(async () => {
    const rows = await api.get<Account[]>(`/communities/${communityId}/cash-accounts`).catch(() => [])
    return Array.isArray(rows) ? rows : []
  }, [api, communityId])

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    ;(async () => {
      let rows = await load()
      if (alive && rows.length === 0 && !seededRef.current) {
        seededRef.current = true
        setSeeding(true)
        await api.post(`/communities/${communityId}/cash-accounts`, { code: 'CASA', name: 'Casă', type: 'PETTY' }).catch(() => {})
        await api.post(`/communities/${communityId}/cash-accounts`, { code: 'BANCA', name: 'Bancă', type: 'BANK' }).catch(() => {})
        rows = await load()
        setSeeding(false)
      }
      if (!alive) return
      setAccounts(rows)
      setLoading(false)
      if (!value && rows.length) {
        const pref = rows.find((r) => r.type === 'PETTY') || rows[0]
        onChange(pref.id, pref)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId])

  const typeLabel = (ty: string) => (ty === 'BANK' ? t('account.bank', 'Cont bancar') : t('account.petty', 'Casierie'))

  async function createAccount() {
    if (!draft.name.trim()) return
    const code = draft.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) || `ACC_${accounts.length + 1}`
    await api.post(`/communities/${communityId}/cash-accounts`, { code, name: draft.name.trim(), type: draft.type }).catch(() => {})
    const rows = await load()
    setAccounts(rows)
    const created = rows.find((r) => r.code === code)
    if (created) onChange(created.id, created)
    setShowCreate(false)
    setDraft({ name: '', type: 'PETTY' })
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label className="label">{t('receipt.account', 'Cont / casierie')}</label>
      {loading || seeding ? (
        <div className="muted">{t('common.loading', 'Loading…')}</div>
      ) : (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="input"
            style={{ minWidth: 200 }}
            value={value}
            onChange={(e) => {
              const acc = accounts.find((a) => a.id === e.target.value)
              onChange(e.target.value, acc)
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name} · {typeLabel(a.type)}</option>
            ))}
          </select>
          <button type="button" className="btn ghost small" onClick={() => setShowCreate((v) => !v)}>
            {t('account.create', '+ Cont nou')}
          </button>
        </div>
      )}
      {showCreate && (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" style={{ width: 160 }} placeholder={t('account.name', 'Nume cont')}
            value={draft.name} onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))} />
          <select className="input" value={draft.type} onChange={(e) => setDraft((s) => ({ ...s, type: e.target.value }))}>
            <option value="PETTY">{t('account.petty', 'Casierie')}</option>
            <option value="BANK">{t('account.bank', 'Cont bancar')}</option>
          </select>
          <button type="button" className="btn primary small" onClick={createAccount}>{t('common.confirm', 'Salvează')}</button>
        </div>
      )}
    </div>
  )
}
