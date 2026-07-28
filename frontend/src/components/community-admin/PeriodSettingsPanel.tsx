import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { UnitAttributesTable } from './UnitAttributesTable'

type PenaltyFund = { code: string; name: string; penaltyFundCode: string; ratePerDayPct: number; stamped: boolean }
type Settings = {
  period: {
    code: string; status: string; dueDate: string | null; afisareDate: string | null; startDate: string; endDate: string
    preparedAt: string | null; closedAt: string | null; editable: boolean
  }
  graceDays: number
  penaltyFunds: PenaltyFund[]
}
type PeriodRow = { code: string; status: string; seq: number }

const fmtDate = (d: string | null) => (d ? String(d).slice(0, 10) : '—')

export function PeriodSettingsPanel({ communityId, readOnly }: { communityId: string; readOnly?: boolean }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [periods, setPeriods] = React.useState<PeriodRow[]>([])
  const [code, setCode] = React.useState<string>('')
  const [s, setS] = React.useState<Settings | null>(null)
  const [dueDate, setDueDate] = React.useState<string>('')
  const [afisareDate, setAfisareDate] = React.useState<string>('')
  const [graceDays, setGraceDays] = React.useState<string>('')
  const [rates, setRates] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Period list (newest first), reusing the avizier's selector pattern.
  React.useEffect(() => {
    if (!communityId) return
    api.get<PeriodRow[]>(`/communities/${communityId}/periods`)
      .then((rows: PeriodRow[]) => {
        const sorted = [...(rows || [])].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
        setPeriods(sorted)
        setCode((cur) => cur || sorted[0]?.code || '')
      })
      .catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  // Settings for the selected period.
  React.useEffect(() => {
    if (!communityId || !code) return
    setMsg(null); setError(null)
    api.get<Settings>(`/communities/${communityId}/periods/${code}/settings`)
      .then((data: Settings) => {
        setS(data)
        setDueDate(data.period.dueDate ? String(data.period.dueDate).slice(0, 10) : '')
        setAfisareDate(data.period.afisareDate ? String(data.period.afisareDate).slice(0, 10) : '')
        setGraceDays(String(data.graceDays ?? ''))
        setRates(Object.fromEntries(data.penaltyFunds.map((f) => [f.code, String(f.ratePerDayPct)])))
      })
      .catch((e: any) => { setS(null); setError(e?.message || 'Failed') })
  }, [api, communityId, code])

  const editable = !!s?.period.editable && !readOnly

  async function save() {
    if (!s) return
    setBusy(true); setMsg(null); setError(null)
    try {
      const body: any = { graceDays: Number(graceDays) }
      if (editable) {
        body.dueDate = dueDate || null
        body.afisareDate = afisareDate || null
        body.penaltyRates = Object.fromEntries(
          s.penaltyFunds.filter((f) => !f.stamped).map((f) => [f.code, Number(rates[f.code] ?? f.ratePerDayPct)]),
        )
      }
      await api.post(`/communities/${communityId}/periods/${code}/settings`, body)
      setMsg(t('common.save', 'Salvat'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('periodSettings.title', 'Setări perioadă')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('periodSettings.hint', 'Scadența, zilele de grație și rata penalizărilor per fond, pentru perioada selectată.')}
      </div>
      {error && <div className="badge negative">{error}</div>}

      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <label className="label" style={{ margin: 0 }}>{t('periodSettings.period', 'Perioadă')}</label>
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {periods.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.status})</option>)}
        </select>
      </div>

      {!s ? <div className="empty">{t('common.loading', 'Loading…')}</div> : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            {t('periodSettings.status', 'Stare')}: <strong>{s.period.status}</strong>
            {' · '}{t('periodSettings.window', 'Interval')}: {fmtDate(s.period.startDate)} – {fmtDate(s.period.endDate)}
            {s.period.closedAt ? <> {' · '}{t('periodSettings.closedAt', 'Închis')}: {fmtDate(s.period.closedAt)}</> : null}
          </div>

          <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div className="stack" style={{ gap: 2 }}>
              <label className="label">{t('periodSettings.afisareDate', 'Data afișare')}</label>
              <input type="date" value={afisareDate} disabled={!editable} onChange={(e) => setAfisareDate(e.target.value)} />
              <span className="muted" style={{ fontSize: 11 }}>{t('periodSettings.afisareHint', 'data publicării avizierului')}</span>
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <label className="label">{t('periodSettings.dueDate', 'Scadență')}</label>
              <input type="date" value={dueDate} disabled={!editable} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <label className="label">{t('periodSettings.grace', 'Zile de grație')}</label>
              <input type="number" min={0} max={365} value={graceDays} disabled={!editable} onChange={(e) => setGraceDays(e.target.value)} style={{ width: 100 }} />
              <span className="muted" style={{ fontSize: 11 }}>{t('periodSettings.graceHint', 'valabil pentru toată asociația')}</span>
            </div>
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <label className="label">{t('periodSettings.rates', 'Rate penalizări pe fond (%/zi)')}</label>
            {s.penaltyFunds.length === 0 && (
              <span className="muted" style={{ fontSize: 12 }}>{t('periodSettings.noFunds', 'Niciun fond cu penalizări configurate.')}</span>
            )}
            {s.penaltyFunds.map((f) => {
              const rateEditable = editable && !f.stamped
              return (
                <div key={f.code} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 8px', border: '1px solid var(--border,#eee)', borderRadius: 6 }}>
                  <span>{f.name} <span className="muted" style={{ fontSize: 11 }}>({f.code})</span></span>
                  <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                    {rateEditable ? (
                      <input type="number" step="0.001" min={0} max={100} value={rates[f.code] ?? ''} onChange={(e) => setRates((r) => ({ ...r, [f.code]: e.target.value }))} style={{ width: 100 }} />
                    ) : (
                      <span>{Number(f.ratePerDayPct)}{f.stamped ? <span className="muted" style={{ fontSize: 11 }}> ({t('periodSettings.stamped', 'aplicat la închidere')})</span> : null}</span>
                    )}
                    <span className="muted" style={{ fontSize: 11 }}>%/zi → {f.penaltyFundCode}</span>
                  </span>
                </div>
              )
            })}
            {editable && s.penaltyFunds.some((f) => !f.stamped) && (
              <span className="muted" style={{ fontSize: 11 }}>{t('periodSettings.rateNote', 'Rata curentă a fondului; se aplică la închiderea perioadei.')}</span>
            )}
          </div>

          <div className="stack" style={{ gap: 4 }}>
            <label className="label">{t('periodSettings.units', 'Persoane & cotă-parte pe unitate')}</label>
            <UnitAttributesTable communityId={communityId} periodCode={code} editable={editable} />
          </div>

          {!editable && (
            <div className="muted" style={{ fontSize: 12 }}>
              {readOnly
                ? t('periodSettings.readOnlyRole', 'Vizualizare — doar administratorul poate modifica.')
                : t('periodSettings.closed', 'Perioadă închisă — setările sunt doar pentru vizualizare.')}
            </div>
          )}
          {editable && (
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn primary" disabled={busy} onClick={save}>{t('common.save', 'Salvează')}</button>
              {msg && <span className="badge positive">{msg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
