import React from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useI18n } from '../../i18n/useI18n'
import { useMetadata, labelOf } from '../../hooks/useMetadata'

// Incidente — tickets of type INCIDENT, one service each (catalogue item), with the action reported
// on it (metadata.incidentActions), an optional equipment scope (the service's equipmentDefs; the
// API returns the affected units) and the reporting unit with its contact. Statuses, actions,
// services and equipment all come from the API (CLAUDE.md rule 4).

type Incident = {
  id: string
  title: string
  description?: string | null
  status: string
  serviceItemId?: string | null
  serviceStatus?: string | null
  equipmentName?: string | null
  equipmentVariant?: string | null
  reporterUnitId?: string | null
  reporterName?: string | null
  reporterPhone?: string | null
  reporterEmail?: string | null
  createdAt?: string
  serviceItem?: { id: string; name: string; domain: string } | null
  reporterUnit?: { id: string; code: string } | null
  createdBy?: { name: string | null; email: string } | null
  affectedUnits?: Array<{ id: string; label: string }>
}
type Service = { id: string; name: string; domain: string; equipmentDefs?: Array<{ name: string; variants?: string[] }> | null }
type Reporter = { id: string; label: string; name: string | null; email: string | null; phone: string | null }
type Form = {
  title: string; description: string; serviceItemId: string; serviceStatus: string; equipment: string
  reporterUnitId: string; reporterName: string; reporterPhone: string; reporterEmail: string
}
const EMPTY: Form = { title: '', description: '', serviceItemId: '', serviceStatus: '', equipment: '', reporterUnitId: '', reporterName: '', reporterPhone: '', reporterEmail: '' }
// The equipment picker's value packs name + variant ("" variant = every unit with that equipment).
const SEP = '\u0001'
const packEq = (name?: string | null, variant?: string | null) => (name ? `${name}${SEP}${variant ?? ''}` : '')

type Props = { communityId: string; readOnly?: boolean }

export function IncidentsTab({ communityId, readOnly = false }: Props) {
  const { api } = useAuth()
  const { t, lang } = useI18n()
  const meta = useMetadata()
  const [rows, setRows] = React.useState<Incident[]>([])
  const [services, setServices] = React.useState<Service[]>([])
  const [reporters, setReporters] = React.useState<Reporter[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [onlyOpen, setOnlyOpen] = React.useState(true)
  const [form, setForm] = React.useState<Form>(EMPTY)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [showForm, setShowForm] = React.useState(false)

  const statuses = meta?.ticketStatuses ?? []
  const openCodes = new Set(statuses.filter((s) => s.open).map((s) => s.key))

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, cat, reps] = await Promise.all([
        api.get<Incident[]>(`/communities/${communityId}/tickets?type=INCIDENT`),
        api.get<{ items: Service[] }>(`/communities/${communityId}/services?lang=${lang}`).catch(() => ({ items: [] })),
        readOnly ? Promise.resolve([]) : api.get<Reporter[]>(`/communities/${communityId}/tickets/reporters`).catch(() => []),
      ])
      setRows(Array.isArray(list) ? list : [])
      setServices(cat?.items ?? [])
      setReporters(Array.isArray(reps) ? reps : [])
    } catch (err: any) {
      setError(err?.message || t('incidents.errorLoad', 'Nu s-au putut încărca incidentele'))
    } finally {
      setLoading(false)
    }
  }, [api, communityId, lang, readOnly])

  React.useEffect(() => { if (communityId) load() }, [communityId, load])

  const serviceOf = (id: string) => services.find((s) => s.id === id)
  const eqOptions = (serviceId: string) =>
    (serviceOf(serviceId)?.equipmentDefs ?? []).flatMap((d) => [
      { value: packEq(d.name, ''), label: `${d.name} — ${t('incidents.allVariants', 'toate')}` },
      ...(d.variants ?? []).map((v) => ({ value: packEq(d.name, v), label: `${d.name} — ${v}` })),
    ])

  /** Choosing the reporting unit prefills the contact fields (still editable). */
  const pickReporter = (unitId: string) => {
    const r = reporters.find((x) => x.id === unitId)
    setForm((f) => ({ ...f, reporterUnitId: unitId, reporterName: r?.name ?? '', reporterPhone: r?.phone ?? '', reporterEmail: r?.email ?? '' }))
  }

  const payload = () => {
    const [equipmentName, equipmentVariant] = form.equipment ? form.equipment.split(SEP) : ['', '']
    return {
      title: form.title,
      description: form.description,
      serviceItemId: form.serviceItemId || null,
      serviceStatus: form.serviceStatus || null,
      equipmentName: equipmentName || null,
      equipmentVariant: equipmentVariant || null,
      reporterUnitId: form.reporterUnitId || null,
      reporterName: form.reporterName,
      reporterPhone: form.reporterPhone,
      reporterEmail: form.reporterEmail,
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.serviceItemId) return
    setSaving(true)
    setError(null)
    try {
      if (editingId) await api.patch(`/communities/${communityId}/tickets/${editingId}`, payload())
      else await api.post(`/communities/${communityId}/tickets`, { type: 'INCIDENT', ...payload() })
      setForm(EMPTY)
      setEditingId(null)
      setShowForm(false)
      await load()
    } catch (err: any) {
      setError(err?.message || t('incidents.errorSave', 'Nu s-a putut salva incidentul'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (r: Incident) => {
    setEditingId(r.id)
    setShowForm(true)
    setForm({
      title: r.title, description: r.description ?? '', serviceItemId: r.serviceItemId ?? '', serviceStatus: r.serviceStatus ?? '',
      equipment: packEq(r.equipmentName, r.equipmentVariant), reporterUnitId: r.reporterUnitId ?? '',
      reporterName: r.reporterName ?? '', reporterPhone: r.reporterPhone ?? '', reporterEmail: r.reporterEmail ?? '',
    })
  }

  const changeStatus = async (id: string, status: string) => {
    setSaving(true)
    try {
      await api.post(`/communities/${communityId}/tickets/${id}/status`, { status })
      await load()
    } catch (err: any) {
      setError(err?.message || t('incidents.errorSave', 'Nu s-a putut salva incidentul'))
    } finally {
      setSaving(false)
    }
  }

  const shown = onlyOpen ? rows.filter((r) => openCodes.has(r.status)) : rows
  const openCount = rows.filter((r) => openCodes.has(r.status)).length
  const reporterLabel = (r: Incident) => reporters.find((x) => x.id === r.reporterUnitId)?.label ?? r.reporterUnit?.code.split('-').slice(3).join('-')
  const actionTone = (code?: string | null) => meta?.incidentActions?.find((a) => a.key === code)?.tone === 'red' ? 'badge negative' : 'badge warning'

  return (
    <div className="stack">
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h4>{t('incidents.heading', 'Incidente')}</h4>
            <div className="muted">{t('incidents.subtitle', 'Defecțiuni raportate pe servicii. Acțiunea raportată coboară starea serviciului dacă acesta era mai bună.')}</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className={openCount ? 'badge negative' : 'badge'}>{t('incidents.openCount', { n: openCount })}</span>
            <label className="row" style={{ gap: 4, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
              {t('incidents.onlyOpen', 'Doar deschise')}
            </label>
            {!readOnly && !showForm && (
              <button className="btn primary small" type="button" onClick={() => { setForm(EMPTY); setEditingId(null); setShowForm(true) }}>
                {t('incidents.new', 'Incident nou')}
              </button>
            )}
          </div>
        </div>
      </div>

      {!readOnly && showForm && (
        <form className="card stack" onSubmit={submit} style={{ gap: 10 }}>
          <h4 style={{ margin: 0 }}>{editingId ? t('incidents.edit', 'Editează incidentul') : t('incidents.new', 'Incident nou')}</h4>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="stack" style={{ gap: 2, minWidth: 220 }}>
              <span className="label">{t('incidents.service', 'Serviciu')}</span>
              <select className="input" required value={form.serviceItemId} onChange={(e) => setForm((f) => ({ ...f, serviceItemId: e.target.value, equipment: '' }))}>
                <option value="">—</option>
                {[...new Set(services.map((s) => s.domain))].map((d) => (
                  <optgroup key={d} label={d}>
                    {services.filter((s) => s.domain === d).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 2, minWidth: 180 }}>
              <span className="label">{t('incidents.action', 'Acțiune')}</span>
              <select className="input" value={form.serviceStatus} onChange={(e) => setForm((f) => ({ ...f, serviceStatus: e.target.value }))}>
                <option value="">—</option>
                {(meta?.incidentActions ?? []).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </label>
            {eqOptions(form.serviceItemId).length > 0 && (
              <label className="stack" style={{ gap: 2, minWidth: 220 }}>
                <span className="label">{t('incidents.equipment', 'Echipament afectat')}</span>
                <select className="input" value={form.equipment} onChange={(e) => setForm((f) => ({ ...f, equipment: e.target.value }))}>
                  <option value="">{t('incidents.wholeService', 'Tot serviciul')}</option>
                  {eqOptions(form.serviceItemId).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <input className="input" required placeholder={t('incidents.title', 'Titlu')} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <textarea className="input" style={{ minHeight: 70 }} placeholder={t('incidents.description', 'Descriere')} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <div>
            <div className="label">{t('incidents.reporter', 'Raportat de')}</div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <select className="input" style={{ minWidth: 160 }} value={form.reporterUnitId} onChange={(e) => pickReporter(e.target.value)} aria-label={t('incidents.reporterUnit', 'Unitate')}>
                <option value="">{t('incidents.reporterUnit', 'Unitate')}</option>
                {reporters.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder={t('incidents.reporterName', 'Nume')} value={form.reporterName} onChange={(e) => setForm((f) => ({ ...f, reporterName: e.target.value }))} />
              <input className="input" style={{ minWidth: 140 }} placeholder={t('incidents.reporterPhone', 'Telefon')} value={form.reporterPhone} onChange={(e) => setForm((f) => ({ ...f, reporterPhone: e.target.value }))} />
              <input className="input" style={{ minWidth: 200 }} placeholder={t('incidents.reporterEmail', 'Email')} value={form.reporterEmail} onChange={(e) => setForm((f) => ({ ...f, reporterEmail: e.target.value }))} />
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="submit" disabled={saving}>{t('incidents.save', 'Salvează')}</button>
            <button className="btn ghost" type="button" disabled={saving} onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY) }}>{t('incidents.cancel', 'Renunță')}</button>
          </div>
        </form>
      )}

      {error && <div className="badge negative">{error}</div>}
      {loading && <div className="muted">{t('common.loading', 'Se încarcă…')}</div>}
      {!loading && shown.length === 0 && <div className="empty">{t('incidents.empty', 'Niciun incident')}</div>}

      {shown.map((r) => (
        <div key={r.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 4, flex: 1, minWidth: 240 }}>
              <strong>{r.title}</strong>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {r.serviceItem && <span className="badge secondary">{r.serviceItem.domain} · {r.serviceItem.name}</span>}
                {r.serviceStatus && <span className={actionTone(r.serviceStatus)}>{labelOf(meta?.incidentActions, r.serviceStatus)}</span>}
                {r.equipmentName && <span className="badge">{r.equipmentName}{r.equipmentVariant ? ` — ${r.equipmentVariant}` : ''}</span>}
                {r.createdAt && <span className="muted" style={{ fontSize: 12 }}>{new Date(r.createdAt).toLocaleString(lang === 'ro' ? 'ro-RO' : 'en-GB')}</span>}
              </div>
              {r.description && <div className="muted">{r.description}</div>}
              {!!r.affectedUnits?.length && (
                <div style={{ fontSize: 13 }}>
                  <span className="muted">{t('incidents.affected', { n: r.affectedUnits.length })}: </span>
                  {r.affectedUnits.map((u) => u.label).join(', ')}
                </div>
              )}
              <div style={{ fontSize: 13 }}>
                <span className="muted">{t('incidents.reporter', 'Raportat de')}: </span>
                {r.reporterUnitId || r.reporterName
                  ? [reporterLabel(r), r.reporterName, r.reporterPhone, r.reporterEmail].filter(Boolean).join(' · ')
                  : <em className="muted">{t('incidents.noReporter', 'necompletat')}</em>}
                {r.createdBy && <span className="muted"> · {t('incidents.recordedBy', 'înregistrat de')} {r.createdBy.name || r.createdBy.email}</span>}
              </div>
            </div>
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              {readOnly ? (
                <span className="badge secondary">{labelOf(statuses, r.status)}</span>
              ) : (
                <>
                  <button className="btn secondary small" type="button" onClick={() => startEdit(r)}>{t('incidents.editBtn', 'Editează')}</button>
                  <select className="input" value={r.status} disabled={saving} onChange={(e) => changeStatus(r.id, e.target.value)} aria-label={t('incidents.status', 'Status')}>
                    {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
