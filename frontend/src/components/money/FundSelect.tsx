import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

type Fund = { id: string; code?: string; name?: string }

/** Fund picker fed by /community-funds/:code (returns funds with ids). */
export function FundSelect({
  communityCode,
  value,
  onChange,
  label,
  placeholder,
}: {
  communityCode: string
  value: string
  onChange: (fundId: string, fund?: Fund) => void
  label?: string
  placeholder?: string
}) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }
  const [funds, setFunds] = React.useState<Fund[]>([])

  React.useEffect(() => {
    if (!communityCode) return
    api.get<Fund[]>(`/community-funds/${communityCode}`)
      .then((rows) => setFunds(Array.isArray(rows) ? rows : []))
      .catch(() => setFunds([]))
  }, [api, communityCode])

  return (
    <div className="stack" style={{ gap: 4 }}>
      {label ? <label className="label">{label}</label> : null}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value, funds.find((f) => f.id === e.target.value))}>
        <option value="">{placeholder || t('fund.select', 'Selectează fondul')}</option>
        {funds.map((f) => <option key={f.id} value={f.id}>{f.name || f.code}</option>)}
      </select>
    </div>
  )
}
