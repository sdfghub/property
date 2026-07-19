import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

const money = (n?: number | null) => (n == null ? '' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

// Admin manual penalty override — two ADJUSTMENT legs (−computed, +approved) with a required comment.
// Shared by the full avizier and the focused penalty-review list.
export function PenaltyOverrideModal({ communityId, period, be, beName, computed, onClose, onSaved }: {
  communityId: string; period: string; be: string; beName?: string; computed: number; onClose: () => void; onSaved: () => void
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [amount, setAmount] = React.useState('')
  const [comment, setComment] = React.useState('')
  const [history, setHistory] = React.useState<any[]>([])
  const [active, setActive] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  React.useEffect(() => {
    api.get<any>(`/communities/${communityId}/finance/avizier/charge-override?period=${encodeURIComponent(period)}&be=${encodeURIComponent(be)}&fund=PENALIZARI`)
      .then((d: any) => { setHistory(d?.rows || []); setActive(d?.active ?? null); if (d?.active?.override != null) setAmount(String(d.active.override)) })
      .catch(() => {})
  }, [api, communityId, period, be])

  const submit = async (clear: boolean) => {
    if (!comment.trim()) { setErr(t('avizier.ovrCommentReq', 'Adaugă un comentariu (motivul).')); return }
    if (!clear && !(amount.trim() !== '' && Number.isFinite(Number(amount)))) { setErr(t('avizier.ovrAmountReq', 'Introdu o sumă validă.')); return }
    setBusy(true); setErr(null)
    try {
      await api.post(`/communities/${communityId}/finance/avizier/charge-override`, { period, be, fund: 'PENALIZARI', amount: clear ? null : Number(amount), comment: comment.trim() })
      onSaved()
    } catch (e: any) { setBusy(false); setErr(e?.message || t('common.error', 'Eroare')) }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'grid', placeItems: 'center', zIndex: 1000 }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '90%', maxHeight: '85vh', overflow: 'auto', background: 'var(--bg,#fff)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ margin: 0 }}>{t('avizier.ovrTitle', 'Ajustează manual penalizarea')}</h4>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{beName || be} · {period}</div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted">{t('avizier.ovrComputed', 'Penalizare calculată')}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(computed)}</strong>
          </div>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>{t('avizier.ovrAmount', 'Penalizare aprobată (RON)')}</span>
            <input className="input" type="number" step="0.01" value={amount} placeholder={String(computed)} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>{t('avizier.ovrComment', 'Motiv (obligatoriu)')}</span>
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {err ? <div className="badge negative">{err}</div> : null}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {active?.override != null ? <button className="btn ghost small" disabled={busy} onClick={() => submit(true)}>{busy ? '…' : t('avizier.ovrClear', 'Revino la calculat')}</button> : null}
            <button className="btn primary small" disabled={busy} onClick={() => submit(false)}>{busy ? '…' : t('avizier.ovrSave', 'Salvează ajustarea')}</button>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>{t('avizier.ovrHint', 'Se înregistrează ca două ajustări (−calculat, +aprobat) cu urmă de audit.')}</div>
          {history.length ? (
            <div style={{ marginTop: 2, borderTop: '1px solid var(--border,#eee)', paddingTop: 6 }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{t('avizier.ovrHistory', 'Istoric ajustări')}</div>
              {history.map((h: any, i: number) => (
                <div key={i} style={{ fontSize: 12, padding: '3px 0', borderTop: i ? '1px dotted var(--border,#eee)' : undefined }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(h.computed)} → {h.override == null ? t('avizier.ovrCleared', 'calculat') : money(h.override)}</span>
                  <span className="muted"> · {h.actor} · {new Date(h.at).toLocaleString('ro-RO')}</span>
                  {h.comment ? <div className="muted" style={{ fontStyle: 'italic' }}>“{h.comment}”</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
