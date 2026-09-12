import React from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useI18n } from '../../../i18n/useI18n'
import { useMetadata, labelOf } from '../../../hooks/useMetadata'
import { money } from '../../money/money-utils'
import { IntakeRecordDrawer } from './IntakeRecordDrawer'
import type { Blocker, ContractIssue, IntakeBatchSummary, IntakeContext, IntakeRecordRow } from './intake-types'

// AI intake (v1, manual loop): copy the prompt pack → run it in an external agent over the month's zip →
// import the agent's JSON → review each proposal → apply. Nothing becomes an invoice/expense until
// "Apply" — and apply goes through the same template submission the month-close uses. Admin-only,
// behind the `aiIntake` feature flag. Statuses, kinds and blocker labels come from /metadata.
type Period = { id: string; code: string; status: string }

export function IntakePanel({ communityId }: { communityId: string }) {
  const { api } = useAuth()
  const { t, lang } = useI18n()
  const meta = useMetadata()
  const localized = (m: any) => (m ? (lang === 'en' ? m.labelEn || m.label : m.label) : null)
  const localizedHint = (m: any) => (m ? (lang === 'en' ? m.hintEn || m.hint : m.hint) : null)
  const statusMeta = (s: string) => meta?.intakeRecordStatuses?.find((m) => m.key === s)
  const blockerMeta = (c: string) => meta?.intakeBlockers?.find((m) => m.key === c)
  const blockerLabel = (b: Blocker) => localized(blockerMeta(b.code)) || labelOf(meta?.intakeBlockers, b.code)

  const [periods, setPeriods] = React.useState<Period[]>([])
  const [periodCode, setPeriodCode] = React.useState<string>('')
  const [batches, setBatches] = React.useState<IntakeBatchSummary[]>([])
  const [selected, setSelected] = React.useState<{ batch: IntakeBatchSummary; records: IntakeRecordRow[] } | null>(null)
  const [ctx, setCtx] = React.useState<IntakeContext | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [issues, setIssues] = React.useState<ContractIssue[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [prompt, setPrompt] = React.useState<{ prompt: string; promptVersion: string } | null>(null)
  const [showPrompt, setShowPrompt] = React.useState(false)
  const [pasted, setPasted] = React.useState('')
  const [hints, setHints] = React.useState<string>('')
  const [hintsOpen, setHintsOpen] = React.useState(false)
  const [hintsDirty, setHintsDirty] = React.useState(false)
  const [open, setOpen] = React.useState<IntakeRecordRow | null>(null)

  const base = `/communities/${communityId}/intake`
  const fail = (e: any) => {
    setError(e?.message || t('intake.msg.failed', 'Something went wrong'))
    const list = e?.body?.issues
    setIssues(Array.isArray(list) ? list : [])
  }

  // periods: default to the latest OPEN one (intake only applies into OPEN periods)
  React.useEffect(() => {
    api.get<Period[]>(`/communities/${communityId}/periods`).then((ps: Period[]) => {
      const list = Array.isArray(ps) ? ps : []
      setPeriods(list)
      const open = [...list].reverse().find((p) => p.status === 'OPEN') ?? list[list.length - 1]
      if (open && !periodCode) setPeriodCode(open.code)
    }).catch(fail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId])

  const loadBatches = React.useCallback(() => api.get<IntakeBatchSummary[]>(`${base}/batches`).then(setBatches).catch(fail), [api, base])
  React.useEffect(() => { api.get<{ hints: string[] }>(`${base}/hints`).then((h: { hints: string[] }) => { setHints((h.hints ?? []).join('\n')); setHintsDirty(false) }).catch(() => {}) }, [api, base])
  const saveHints = () => act('hints', async () => { const h = await api.post<{ hints: string[] }>(`${base}/hints`, { hints }); setHints(h.hints.join('\n')); setHintsDirty(false); setPrompt(null) }, t('intake.hints.saved', 'Hints saved — the prompt pack now includes them'))
  React.useEffect(() => { loadBatches() }, [loadBatches])
  React.useEffect(() => {
    setPrompt(null)
    if (periodCode) api.get<IntakeContext>(`${base}/context?periodCode=${periodCode}`).then(setCtx).catch(() => setCtx(null))
  }, [api, base, periodCode])

  const selectBatch = async (id: string) => {
    setError(null)
    try {
      const d = await api.get<{ batch: IntakeBatchSummary; records: IntakeRecordRow[] }>(`${base}/batches/${id}`)
      setSelected(d)
      if (d.batch.periodCode && d.batch.periodCode !== periodCode) setPeriodCode(d.batch.periodCode)
    } catch (e) { fail(e) }
  }
  const refreshSelected = async () => { if (selected) await selectBatch(selected.batch.id); await loadBatches() }

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError(null); setIssues([]); setNotice(null)
    try { await fn(); if (done) setNotice(done) } catch (e) { fail(e) } finally { setBusy(null) }
  }

  // ── prompt pack ─────────────────────────────────────────────────────────────────────────────
  const fetchPrompt = () => api.get<{ prompt: string; promptVersion: string }>(`${base}/prompt?periodCode=${periodCode}&format=json`).then((p: { prompt: string; promptVersion: string }) => { setPrompt(p); return p })
  const copyPrompt = () => act('prompt', async () => {
    const p = prompt ?? (await fetchPrompt())
    await navigator.clipboard.writeText(p.prompt)
  }, t('intake.prompt.copied', 'Prompt copied to the clipboard'))
  const downloadPrompt = () => act('prompt', async () => {
    const p = prompt ?? (await fetchPrompt())
    const url = URL.createObjectURL(new Blob([p.prompt], { type: 'text/markdown' }))
    const a = document.createElement('a'); a.href = url; a.download = `intake-prompt-${periodCode}.md`; a.click(); URL.revokeObjectURL(url)
  })
  const previewPrompt = () => act('prompt', async () => { if (!prompt) await fetchPrompt(); setShowPrompt((v) => !v) })

  // ── import ──────────────────────────────────────────────────────────────────────────────────
  const importFile = (file: File | null) => {
    if (!file) return
    act('import', async () => {
      const form = new FormData()
      form.append('file', file)
      if (periodCode) form.append('periodCode', periodCode)
      const d = await api.post<{ batch: IntakeBatchSummary; records: IntakeRecordRow[] }>(`${base}/batches`, form)
      setSelected(d); await loadBatches()
    }, t('intake.import.done', 'Imported — review the records below'))
  }
  const importPasted = () => act('import', async () => {
    const d = await api.post<{ batch: IntakeBatchSummary; records: IntakeRecordRow[] }>(`${base}/batches`, { periodCode: periodCode || undefined, payload: pasted })
    setSelected(d); setPasted(''); await loadBatches()
  }, t('intake.import.done', 'Imported — review the records below'))

  // ── record / batch actions ──────────────────────────────────────────────────────────────────
  const patch = (r: IntakeRecordRow, body: any) => api.patch<IntakeRecordRow>(`${base}/batches/${selected!.batch.id}/records/${r.id}`, body)
  const approve = (r: IntakeRecordRow) => act(r.id, async () => { await patch(r, { action: 'APPROVE' }); await refreshSelected() })
  const skip = (r: IntakeRecordRow) => act(r.id, async () => { await patch(r, { action: 'SKIP' }); await refreshSelected() })
  const reopen = (r: IntakeRecordRow) => act(r.id, async () => { await patch(r, { action: 'REOPEN' }); await refreshSelected() })
  const recheck = () => act('batch', async () => { await api.post(`${base}/batches/${selected!.batch.id}/recheck`, {}); await refreshSelected() })
  const applyBatch = () => {
    const n = selected?.records.filter((r) => r.status === 'APPROVED' || r.status === 'FAILED' || r.status === 'STAGED').length ?? 0
    if (!n || !window.confirm(t('intake.batch.applyConfirm', { n }))) return
    act('batch', async () => {
      const res = await api.post<{ applied: any[]; staged: Array<{ recordId: string; waitingFor: string[] }>; failed: Array<{ recordId: string; error: string }> }>(`${base}/batches/${selected!.batch.id}/apply`, {})
      await refreshSelected()
      const stagedNote = res.staged?.length ? ` ${t('intake.msg.staged', { n: res.staged.length, types: [...new Set(res.staged.flatMap((s: { waitingFor: string[] }) => s.waitingFor))].join(', ') })}` : ''
      if (res.failed?.length) setError(`${t('intake.msg.partial', { ok: res.applied.length, failed: res.failed.length })}${stagedNote}\n${res.failed.map((f: { error: string }) => `• ${f.error}`).join('\n')}`)
      else setNotice(`${t('intake.msg.applied', { n: res.applied.length })}${stagedNote}`)
    })
  }
  const deleteBatch = () => {
    if (!selected || !window.confirm(t('intake.batch.deleteConfirm', 'Delete this import and all its records?'))) return
    act('batch', async () => { await api.del(`${base}/batches/${selected.batch.id}`); setSelected(null); await loadBatches() })
  }

  const bankSummary = (r: IntakeRecordRow) => {
    const m = r.effective?.bankLine ? r.effective.mapping : null
    const res = r.resolved ?? {}
    if (!m) return r.extracted?.description ?? '—'
    const target = localized(meta?.intakeBankTargets?.find((x) => x.key === m.target)) || m.target
    if (m.target === 'OWNER_PAYMENT') {
      const who = res.unitLabel ? `${res.unitLabel} · ${res.billingEntityName ?? '?'}` : res.suggestedUnitCode ? `${res.suggestedUnitCode}?` : m.unitCode ?? m.payerName ?? '?'
      const funds = m.funds.map((f) => `${f.fundCode} ${Number(f.amount).toFixed(2)}`).join(', ')
      return `${target} → ${who}${funds ? ` · ${funds}` : ''}${m.cycleCode ? ` · ${m.cycleCode}` : ''}`
    }
    if (m.target === 'VENDOR_SETTLEMENT') return `${target} → ${(res.invoices ?? []).map((x: any) => `${x.vendorName ?? '?'} ${x.number}`).join(', ') || m.invoiceNumbers.join(', ') || m.vendorName || '?'}`
    if (m.target === 'CASH_TX') return `${target} → ${res.cashFundCode ?? m.fundCode ?? m.expenseTypeCode ?? '?'}${m.kind ? ` · ${m.kind}` : ''}`
    return `${target}${m.reason ? ` · ${m.reason}` : ''}`
  }
  const summary = (r: IntakeRecordRow) => {
    if (r.kind === 'BANK_LINE') return bankSummary(r)
    if (r.kind !== 'INVOICE' || !r.effective?.invoice) return r.extracted?.note ?? ''
    const m = r.effective.mapping
    if (m?.allocations?.length) {
      const by: Record<string, string[]> = {}
      for (const a of m.allocations) (by[a.templateCode] = by[a.templateCode] || []).push(`${a.itemKey} ${Number(a.amount).toFixed(2)}`)
      return Object.entries(by).map(([tpl, items]) => `${tpl}: ${items.join(', ')}`).join(' | ')
    }
    if (m?.fallback) return `${t('intake.form.fallback', 'No template')} → ${m.fallback.fundCode ?? m.fallback.expenseTypeCode ?? '?'}`
    return '—'
  }
  const confidenceTone = (c: number | null) => (c == null ? '' : c >= 0.85 ? 'positive' : c >= 0.6 ? 'warning' : 'negative')
  const approvable = selected?.records.filter((r) => r.status === 'APPROVED' || r.status === 'FAILED' || r.status === 'STAGED').length ?? 0
  const periodOpen = ctx?.period?.status === 'OPEN'

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{t('intake.title', 'AI intake')}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{t('intake.subtitle', 'Prompt for an external agent → import its JSON → review → apply as invoices and expenses')}</div>
          </div>
          <label className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="label" style={{ margin: 0 }}>{t('intake.period', 'Period')}</span>
            <select className="input" value={periodCode} onChange={(e) => setPeriodCode(e.target.value)}>
              {periods.map((p) => <option key={p.code} value={p.code}>{p.code} · {p.status}</option>)}
            </select>
          </label>
        </div>
        {ctx && !periodOpen && <div className="badge warning" style={{ marginTop: 8 }}>{t('intake.msg.periodNotOpen', { code: ctx.period.code, status: ctx.period.status })}</div>}
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div style={{ color: 'var(--danger)', whiteSpace: 'pre-wrap' }}>{error}</div>
        {issues.length > 0 && <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{issues.map((i, k) => <li key={k}><code>{i.path}</code> — {i.message}</li>)}</ul>}
      </div>}
      {notice && <div className="badge positive">{notice}</div>}

      <div className="row" style={{ gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h3>{t('intake.prompt.title', '1 · Prompt pack')}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{t('intake.prompt.hint', 'Give this prompt to an agent (Claude Code, claude.ai…) together with the month\'s zip of invoices and statements. It contains this association\'s templates, vendors and the exact JSON format to produce.')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={!periodCode || busy === 'prompt'} onClick={copyPrompt}>{t('intake.prompt.copy', 'Copy prompt')}</button>
            <button className="btn secondary" disabled={!periodCode || busy === 'prompt'} onClick={downloadPrompt}>{t('intake.prompt.download', 'Download .md')}</button>
            <button className="btn tertiary" disabled={!periodCode || busy === 'prompt'} onClick={previewPrompt}>{showPrompt ? t('intake.prompt.hide', 'Hide') : t('intake.prompt.preview', 'Preview')}</button>
          </div>
          {prompt && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('intake.prompt.version', 'Prompt version')}: {prompt.promptVersion}</div>}
          <div style={{ marginTop: 10 }}>
            <button className="btn tertiary small" onClick={() => setHintsOpen((v) => !v)}>
              {hintsOpen ? t('intake.hints.hide', 'Hide hints') : t('intake.hints.show', { n: hints.split('\n').filter((l) => l.trim()).length })}
            </button>
            {hintsOpen && (
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 12 }}>{t('intake.hints.hint', 'One hint per line. These are appended to the prompt as "association-specific hints" — everything the agent should know about this association\'s suppliers and documents that it cannot guess (vendor name aliases, which template a supplier\'s lines go to, how prior balances appear, monthly quirks).')}</div>
                <textarea className="input" rows={8} value={hints} onChange={(e) => { setHints(e.target.value); setHintsDirty(true) }} style={{ fontSize: 12 }} />
                <div><button className="btn small" disabled={!hintsDirty || busy === 'hints'} onClick={saveHints}>{t('intake.hints.save', 'Save hints')}</button></div>
              </div>
            )}
          </div>
          {showPrompt && prompt && <pre style={{ maxHeight: 320, overflow: 'auto', fontSize: 11, background: 'var(--field-bg)', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '100%' }}>{prompt.prompt}</pre>}
        </div>

        <div className="card" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h3>{t('intake.import.title', '2 · Import the agent\'s JSON')}</h3>
          <p className="muted" style={{ fontSize: 13 }}>{t('intake.import.hint', 'Upload the file the agent produced (or paste it). Records are checked against the live templates, vendors and existing invoices — nothing is written yet.')}</p>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="btn secondary" style={{ cursor: 'pointer' }}>
              {busy === 'import' ? t('intake.import.uploading', 'Importing…') : t('intake.import.upload', 'Upload .json')}
              <input type="file" accept=".json,application/json" style={{ display: 'none' }} disabled={busy === 'import'} onChange={(e) => { importFile(e.target.files?.[0] ?? null); e.currentTarget.value = '' }} />
            </label>
            <span className="muted" style={{ fontSize: 12 }}>{t('intake.import.or', 'or paste below')}</span>
          </div>
          <textarea className="input" rows={4} placeholder='{ "contractVersion": "intake-import/v2", … }' value={pasted} onChange={(e) => setPasted(e.target.value)} style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12 }} />
          <div style={{ marginTop: 8 }}>
            <button className="btn small" disabled={!pasted.trim() || busy === 'import'} onClick={importPasted}>{t('intake.import.submit', 'Import pasted JSON')}</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>{t('intake.batch.title', '3 · Imports')}</h3>
        {batches.length === 0 ? <div className="empty">{t('intake.batch.empty', 'No imports yet.')}</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr>
                <th>{t('intake.col.created', 'Imported')}</th><th>{t('intake.col.period', 'Period')}</th><th>{t('intake.col.agent', 'Agent')}</th><th>{t('intake.col.file', 'File')}</th><th>{t('intake.col.records', 'Records')}</th><th>{t('intake.col.status', 'Status')}</th>
              </tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} onClick={() => selectBatch(b.id)} style={{ cursor: 'pointer', background: selected?.batch.id === b.id ? 'var(--accent-soft)' : undefined }}>
                    <td>{new Date(b.createdAt).toLocaleString(lang === 'en' ? 'en-GB' : 'ro-RO')}</td>
                    <td>{b.periodCode}</td>
                    <td>{b.agentLabel ?? '—'}</td>
                    <td>{b.sourceFileName ?? '—'}</td>
                    <td>{b.stats ? Object.entries(b.stats.byStatus).map(([s, n]) => `${localized(statusMeta(s)) || s} ${n}`).join(' · ') : '—'}</td>
                    <td><span className={`badge ${meta?.intakeBatchStatuses?.find((m) => m.key === b.status)?.tone || ''}`}>{localized(meta?.intakeBatchStatuses?.find((m) => m.key === b.status)) || b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>{t('intake.records.title', '4 · Review')} — {selected.batch.periodCode}</h3>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn tertiary small" disabled={busy === 'batch'} onClick={recheck}>{t('intake.action.recheck', 'Re-check')}</button>
              <button className="btn tertiary small" disabled={busy === 'batch' || selected.batch.status === 'APPLIED'} onClick={deleteBatch}>{t('intake.action.delete', 'Delete import')}</button>
              <button className="btn small" disabled={busy === 'batch' || !approvable || !periodOpen} onClick={applyBatch} title={!periodOpen ? t('intake.msg.periodNotOpenShort', 'Period is not OPEN') : ''}>
                {t('intake.action.apply', { n: approvable })}
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>{t('intake.records.hint', 'Open a record to correct its mapping. Approve what is right, skip the rest, then Apply — invoices and expense lines are created only then, through the normal template submission.')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead><tr>
                <th>#</th><th>{t('intake.col.file', 'File')}</th><th>{t('intake.col.vendor', 'Vendor')}</th><th>{t('intake.col.number', 'Number')}</th><th style={{ textAlign: 'right' }}>{t('intake.col.gross', 'Gross')}</th><th>{t('intake.col.mapping', 'Mapping')}</th><th>{t('intake.col.confidence', 'Conf.')}</th><th>{t('intake.col.status', 'Status')} · {t('intake.col.blockers', 'Checks')}</th>
              </tr></thead>
              <tbody>
                {selected.records.map((r) => {
                  const inv = r.effective?.invoice
                  const actionable = r.kind === 'INVOICE' || r.kind === 'BANK_LINE'
                  const canApprove = actionable && r.status !== 'APPLIED' && r.status !== 'APPROVED' && r.remaining.length === 0 && (r.kind !== 'BANK_LINE' || (!!r.effective?.mapping && !(r.status === 'SKIPPED' && (r.effective.mapping as any).target === 'IGNORE')))
                  const lineAmt = r.kind === 'BANK_LINE' ? Number(r.extracted?.amount) || 0 : 0
                  return (
                    <tr key={r.id} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
                      <td>{r.index}</td>
                      <td title={r.sourceFile ?? ''} style={{ maxWidth: 130 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sourceFile ?? '—'}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{localized(meta?.intakeRecordKinds?.find((m) => m.key === r.kind)) || r.kind}</div>
                      </td>
                      <td style={{ maxWidth: 120 }}>{inv?.vendorName ?? r.extracted?.counterpartyName ?? '—'}</td>
                      <td style={{ maxWidth: 100, wordBreak: 'break-word' }}>{inv?.number ?? r.extracted?.reference ?? '—'}</td>
                      <td style={{ textAlign: 'right', color: r.kind === 'BANK_LINE' ? (lineAmt < 0 ? 'var(--danger)' : 'var(--success, inherit)') : undefined }}>{inv ? money(inv.gross, inv.currency ?? 'RON') : r.kind === 'BANK_LINE' ? money(lineAmt, r.extracted?.currency ?? 'RON') : ''}</td>
                      <td style={{ maxWidth: 200 }}>{summary(r)}</td>
                      <td>{r.confidence != null && <span className={`badge ${confidenceTone(r.confidence)}`}>{Math.round(r.confidence * 100)}%</span>}</td>
                      <td style={{ fontSize: 12, minWidth: 180 }}>
                        <div style={{ marginBottom: 4 }}><span className={`badge ${statusMeta(r.status)?.tone || ''}`} title={localizedHint(statusMeta(r.status)) || ''}>{localized(statusMeta(r.status)) || r.status}</span></div>
                        {r.blockers.map((b, i) => (
                          <span key={i} className={`badge ${r.remaining.some((x) => x.code === b.code) ? (b.overridable ? 'warning' : 'negative') : ''}`} title={`${b.message}${localizedHint(blockerMeta(b.code)) ? ` — ${localizedHint(blockerMeta(b.code))}` : ''}`} style={{ marginRight: 4, marginBottom: 2 }}>
                            {blockerLabel(b)}{!r.remaining.some((x) => x.code === b.code) && b.overridable ? ' ✓' : ''}
                          </span>
                        ))}
                        {r.error && <div style={{ color: 'var(--danger)' }}>{r.error}</div>}
                        {r.status === 'STAGED' && r.appliedRefs?.waitingFor?.length > 0 && <div className="muted">{t('intake.msg.waitingFor', { types: r.appliedRefs.waitingFor.join(', ') })}</div>}
                        {r.status === 'APPLIED' && r.appliedRefs?.paymentId && <div className="muted">{money(r.appliedRefs.applied ?? 0, r.extracted?.currency ?? 'RON')} {t('intake.drawer.onCharges', 'on charges')}{(r.appliedRefs.advance ?? 0) > 0 ? ` · ${money(r.appliedRefs.advance, r.extracted?.currency ?? 'RON')} ${t('intake.drawer.asAdvance', 'as advance')}` : ''}</div>}
                        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {canApprove && <button className="btn small" disabled={busy === r.id} onClick={() => approve(r)}>{t('intake.action.approve', 'Approve')}</button>}
                          {r.status !== 'APPLIED' && r.status !== 'SKIPPED' && r.status !== 'STAGED' && <button className="btn tertiary small" disabled={busy === r.id} onClick={() => skip(r)}>{t('intake.action.skip', 'Skip')}</button>}
                          {(r.status === 'SKIPPED' || r.status === 'APPROVED' || r.status === 'STAGED') && actionable && <button className="btn tertiary small" disabled={busy === r.id} onClick={() => reopen(r)}>{t('intake.action.reopen', 'Reopen')}</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && selected && (
        <IntakeRecordDrawer
          record={open}
          ctx={ctx}
          busy={busy === open.id}
          onClose={() => setOpen(null)}
          onSave={async (body) => { await act(open.id, async () => { const r = await patch(open, body); setOpen(r); await refreshSelected() }) }}
          onApprove={async (body) => { await act(open.id, async () => { const r = await patch(open, { ...body, action: 'APPROVE' }); setOpen(r); await refreshSelected() }) }}
        />
      )}
    </div>
  )
}
