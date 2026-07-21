import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'

// #16 Units & Unit Groups configurator. Backed by the existing admin structure endpoints
// (community-structure.controller.ts): GET/POST units, GET/POST unit-groups, and
// POST unit-groups/:groupId/members (a unit joined to a group for a period range). There is no
// list-members endpoint yet, so current membership isn't rendered — adding a member confirms success.
type Unit = { id: string; code: string; order: number }
type UnitGroup = { id: string; code: string; name: string }
type PeriodRow = { code: string; status: string; seq: number }

export function StructurePanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t: rawT } = useI18n()
  const t = (k: string, d = '') => { const v = rawT(k as any); return v && v !== k ? v : d }

  const [units, setUnits] = React.useState<Unit[]>([])
  const [groups, setGroups] = React.useState<UnitGroup[]>([])
  const [periods, setPeriods] = React.useState<PeriodRow[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [msg, setMsg] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const [newUnit, setNewUnit] = React.useState({ code: '', order: '' })
  const [newGroup, setNewGroup] = React.useState({ code: '', name: '' })
  const [member, setMember] = React.useState<Record<string, { unitCode: string; startPeriodCode: string; endPeriodCode: string }>>({})

  const load = React.useCallback(() => {
    if (!communityId) return
    Promise.all([
      api.get<Unit[]>(`/communities/${communityId}/units`),
      api.get<UnitGroup[]>(`/communities/${communityId}/unit-groups`),
      api.get<PeriodRow[]>(`/communities/${communityId}/periods`),
    ]).then(([u, g, p]) => {
      setUnits(u || [])
      setGroups(g || [])
      setPeriods([...(p || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)))
    }).catch((e: any) => setError(e?.message || 'Failed'))
  }, [api, communityId])

  React.useEffect(() => { load() }, [load])

  const flash = (m: string) => { setMsg(m); setError(null); window.setTimeout(() => setMsg(null), 2500) }

  async function createUnit(e: React.FormEvent) {
    e.preventDefault()
    if (!newUnit.code.trim()) return
    setBusy(true); setError(null)
    try {
      await api.post(`/communities/${communityId}/units`, { code: newUnit.code.trim(), order: newUnit.order ? Number(newUnit.order) : 0 })
      setNewUnit({ code: '', order: '' }); flash(t('common.save', 'Salvat')); load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroup.code.trim() || !newGroup.name.trim()) return
    setBusy(true); setError(null)
    try {
      await api.post(`/communities/${communityId}/unit-groups`, { code: newGroup.code.trim(), name: newGroup.name.trim() })
      setNewGroup({ code: '', name: '' }); flash(t('common.save', 'Salvat')); load()
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  async function addMember(group: UnitGroup) {
    const m = member[group.id]
    if (!m?.unitCode || !m?.startPeriodCode) { setError(t('structure.memberNeeds', 'Alege unitatea și perioada de început')); return }
    setBusy(true); setError(null)
    try {
      await api.post(`/communities/${communityId}/unit-groups/${group.id}/members`, {
        unitCode: m.unitCode, startPeriodCode: m.startPeriodCode, endPeriodCode: m.endPeriodCode || undefined,
      })
      setMember((s) => ({ ...s, [group.id]: { unitCode: '', startPeriodCode: '', endPeriodCode: '' } }))
      flash(t('structure.memberAdded', 'Unitate adăugată în grup'))
    } catch (e: any) { setError(e?.message || 'Failed') } finally { setBusy(false) }
  }

  const setM = (gid: string, patch: Partial<{ unitCode: string; startPeriodCode: string; endPeriodCode: string }>) =>
    setMember((s) => {
      const cur = s[gid] ?? { unitCode: '', startPeriodCode: '', endPeriodCode: '' }
      return { ...s, [gid]: { ...cur, ...patch } }
    })

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4 style={{ marginTop: 0 }}>{t('structure.title', 'Unități & grupuri de unități')}</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {t('structure.hint', 'Gestionează unitățile clădirii și grupurile de unități (partiții/etichete pe intervale de perioade).')}
      </div>
      {error && <div className="badge negative">{error}</div>}
      {msg && <div className="badge positive">{msg}</div>}

      <div className="stack" style={{ gap: 16, marginTop: 8 }}>
        {/* ── Units ── */}
        <div className="stack" style={{ gap: 6 }}>
          <label className="label">{t('structure.units', 'Unități')} <span className="muted">({units.length})</span></label>
          <div className="card soft" style={{ maxHeight: 220, overflow: 'auto', padding: 8 }}>
            {units.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>{t('structure.noUnits', 'Nicio unitate.')}</span> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} style={{ borderTop: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '4px 8px' }}>{u.code}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--muted,#666)' }}>#{u.order}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }} onSubmit={createUnit}>
            <input className="input" style={{ minWidth: 200 }} placeholder={t('structure.unitCode', 'Cod unitate')} value={newUnit.code} onChange={(e) => setNewUnit((s) => ({ ...s, code: e.target.value }))} required />
            <input className="input" style={{ width: 90 }} type="number" placeholder={t('structure.order', 'Ordine')} value={newUnit.order} onChange={(e) => setNewUnit((s) => ({ ...s, order: e.target.value }))} />
            <button className="btn primary small" type="submit" disabled={busy}>{t('structure.addUnit', 'Adaugă unitate')}</button>
          </form>
        </div>

        {/* ── Unit groups ── */}
        <div className="stack" style={{ gap: 6 }}>
          <label className="label">{t('structure.groups', 'Grupuri de unități')} <span className="muted">({groups.length})</span></label>
          {groups.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>{t('structure.noGroups', 'Niciun grup.')}</span> : (
            <div className="stack" style={{ gap: 6 }}>
              {groups.map((g) => {
                const m = member[g.id] || { unitCode: '', startPeriodCode: '', endPeriodCode: '' }
                return (
                  <div key={g.id} className="card soft" style={{ padding: 8 }}>
                    <div><strong>{g.name}</strong> <span className="muted" style={{ fontSize: 11 }}>({g.code})</span></div>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                      <select className="input" value={m.unitCode} onChange={(e) => setM(g.id, { unitCode: e.target.value })} style={{ minWidth: 160 }}>
                        <option value="">{t('structure.pickUnit', 'Unitate…')}</option>
                        {units.map((u) => <option key={u.id} value={u.code}>{u.code}</option>)}
                      </select>
                      <select className="input" value={m.startPeriodCode} onChange={(e) => setM(g.id, { startPeriodCode: e.target.value })} title={t('structure.startPeriod', 'Perioada de început')}>
                        <option value="">{t('structure.startPeriod', 'De la…')}</option>
                        {periods.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
                      </select>
                      <select className="input" value={m.endPeriodCode} onChange={(e) => setM(g.id, { endPeriodCode: e.target.value })} title={t('structure.endPeriod', 'Perioada de sfârșit (opțional)')}>
                        <option value="">{t('structure.endOpen', 'Până la… (deschis)')}</option>
                        {periods.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
                      </select>
                      <button className="btn secondary small" type="button" disabled={busy} onClick={() => addMember(g)}>{t('structure.addMember', 'Adaugă în grup')}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }} onSubmit={createGroup}>
            <input className="input" style={{ width: 160 }} placeholder={t('structure.groupCode', 'Cod grup')} value={newGroup.code} onChange={(e) => setNewGroup((s) => ({ ...s, code: e.target.value }))} required />
            <input className="input" style={{ minWidth: 200 }} placeholder={t('structure.groupName', 'Nume grup')} value={newGroup.name} onChange={(e) => setNewGroup((s) => ({ ...s, name: e.target.value }))} required />
            <button className="btn primary small" type="submit" disabled={busy}>{t('structure.addGroup', 'Adaugă grup')}</button>
          </form>
          <span className="muted" style={{ fontSize: 11 }}>{t('structure.membersNote', 'Membrii existenți nu sunt listați încă (fără endpoint de citire); adăugarea confirmă succesul.')}</span>
        </div>
      </div>
    </div>
  )
}
