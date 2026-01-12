import React from 'react'
import { useI18n } from '../../i18n/useI18n'
import { ProgramDetails } from '../ProgramDetails'
import { useAuth } from '../../hooks/useAuth'

type Props = {
  programs: any[]
  programError: string | null
  communityCode: string
  onRefreshPrograms?: () => void | Promise<void>
}

type ProgramLedgerDigest = {
  program: { id: string; code: string; name?: string; bucket: string }
  summary: {
    inflow: number
    outflow: number
    net: number
    lineCount: number
    firstAt: string | null
    lastAt: string | null
    currency: string | null
  }
  byKind: Array<{ kind: string; total: number; count: number }>
  byRefType: Array<{ refType: string; total: number; count: number }>
  recent: Array<{
    id: string
    kind?: string | null
    refType?: string | null
    refId?: string | null
    amount: any
    currency?: string | null
    createdAt?: string | null
    meta?: any
  }>
}

export function ProgramsTab({ programs, programError, communityCode, onRefreshPrograms }: Props) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [activeCode, setActiveCode] = React.useState<string | null>(
    programs[0]?.code ?? null,
  )
  const [ledger, setLedger] = React.useState<ProgramLedgerDigest | null>(null)
  const [ledgerError, setLedgerError] = React.useState<string | null>(null)
  const [ledgerLoading, setLedgerLoading] = React.useState(false)
  const [invoices, setInvoices] = React.useState<any[]>([])
  const [invLoading, setInvLoading] = React.useState(false)
  const [invLoaded, setInvLoaded] = React.useState(false)
  const [invError, setInvError] = React.useState<string | null>(null)
  const [linking, setLinking] = React.useState(false)
  const [linkInvoiceId, setLinkInvoiceId] = React.useState<string>('')
  const [linkAmount, setLinkAmount] = React.useState<string>('')
  const [linkPortionKey, setLinkPortionKey] = React.useState<string>('')
  const [creating, setCreating] = React.useState(false)
  const [showNewInvoice, setShowNewInvoice] = React.useState(false)
  const [newInv, setNewInv] = React.useState({
    vendorName: '',
    number: '',
    gross: '',
    currency: 'RON',
    issueDate: '',
  })
  const [importFile, setImportFile] = React.useState<File | null>(null)
  const [importLoading, setImportLoading] = React.useState(false)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [importSuccess, setImportSuccess] = React.useState<string | null>(null)
  const lastLedgerKeyRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!activeCode && programs.length > 0) {
      setActiveCode(programs[0].code)
    } else if (activeCode && programs.every((p) => p.code !== activeCode)) {
      // Reset when the list changes and the active program is gone
      setActiveCode(programs[0]?.code ?? null)
    }
  }, [programs, activeCode])

  const activeProgram = programs.find((p) => p.code === activeCode)

  React.useEffect(() => {
    if (!communityCode || !activeProgram?.id) {
      setLedger(null)
      setLedgerError(null)
      return
    }
    const ledgerKey = `${communityCode}:${activeProgram.id}`
    if (lastLedgerKeyRef.current === ledgerKey) return
    lastLedgerKeyRef.current = ledgerKey
    const controller = new AbortController()
    const load = async () => {
      setLedgerLoading(true)
      setLedgerError(null)
      try {
        const rows = await api.get<ProgramLedgerDigest>(
          `/communities/${communityCode}/programs/${activeProgram.id}/ledger`,
          undefined,
          controller.signal as any,
        )
        if (!controller.signal.aborted) setLedger(rows || null)
      } catch (err: any) {
        if (controller.signal.aborted) return
        setLedger(null)
        setLedgerError(err?.message || 'Failed to load ledger')
      } finally {
        if (!controller.signal.aborted) setLedgerLoading(false)
      }
    }
    load()
    return () => controller.abort()
  }, [api, communityCode, activeProgram?.id])

  const fetchInvoices = React.useCallback(
    async (signal?: AbortSignal) => {
      if (!communityCode) return
      setInvLoading(true)
      setInvError(null)
      try {
        const rows = await api.get<any[]>(`/communities/${communityCode}/invoices`, undefined, signal as any)
        if (!signal || !signal.aborted) {
          setInvoices(rows || [])
          setInvLoaded(true)
        }
      } catch (err: any) {
        if (signal && signal.aborted) return
        setInvoices([])
        setInvError(err?.message || 'Failed to load invoices')
      } finally {
        if (!signal || !signal.aborted) setInvLoading(false)
      }
    },
    [api, communityCode],
  )

  const reloadInvoicesAndLedger = React.useCallback(async () => {
    await fetchInvoices()
    if (activeProgram?.id) {
      try {
        const data = await api.get<ProgramLedgerDigest>(
          `/communities/${communityCode}/programs/${activeProgram.id}/ledger`,
        )
        setLedger(data || null)
      } catch {
        /* ignore */
      }
    }
  }, [api, communityCode, activeProgram?.id])

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeProgram?.id || !linkInvoiceId) return
    setLinking(true)
    try {
      await api.post(`/communities/${communityCode}/invoices/${linkInvoiceId}/program-links`, {
        programId: activeProgram.id,
        amount: linkAmount ? Number(linkAmount) : undefined,
        portionKey: linkPortionKey || undefined,
      })
      setLinkAmount('')
      setLinkPortionKey('')
      await reloadInvoicesAndLedger()
    } catch (err: any) {
      setInvError(err?.message || 'Failed to link invoice')
    } finally {
      setLinking(false)
    }
  }

  const handleUnlink = async (invoiceId: string, portionKey?: string | null) => {
    if (!activeProgram?.id) return
    setLinking(true)
    try {
      await api.post(`/communities/${communityCode}/invoices/${invoiceId}/program-links/remove`, {
        programId: activeProgram.id,
        portionKey: portionKey ?? null,
      })
      await reloadInvoicesAndLedger()
    } catch (err: any) {
      setInvError(err?.message || 'Failed to unlink invoice')
    } finally {
      setLinking(false)
    }
  }

  const linkedInvoiceMap = new Map<string, any[]>()
  invoices.forEach((inv) => {
    const links = (inv.programInvoices || []).filter((pi: any) => pi.programId === activeProgram?.id)
    if (links.length) linkedInvoiceMap.set(inv.id, links)
  })
  const availableInvoices = activeProgram
    ? invoices.filter((inv) => {
        const links = linkedInvoiceMap.get(inv.id) || []
        const linkedSum = links.reduce((s, l) => s + Number(l.amount ?? 0), 0)
        const gross = inv.gross != null ? Number(inv.gross) : null
        if (gross == null) return true
        return linkedSum < gross
      })
    : invoices

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newInv.vendorName || !newInv.number) return
    setCreating(true)
    try {
      await api.post(`/communities/${communityCode}/invoices`, {
        vendorName: newInv.vendorName,
        number: newInv.number,
        gross: newInv.gross ? Number(newInv.gross) : null,
        currency: newInv.currency || 'RON',
        issueDate: newInv.issueDate || null,
      })
      setNewInv({ vendorName: '', number: '', gross: '', currency: 'RON', issueDate: '' })
      await reloadInvoicesAndLedger()
    } catch (err: any) {
      setInvError(err?.message || 'Failed to create invoice')
    } finally {
      setCreating(false)
    }
  }

  const balance = ledger?.summary?.net ?? 0

  const handleImportPrograms = async () => {
    if (!communityCode) return
    if (!importFile) {
      setImportError(t('programs.import.noFile'))
      setImportSuccess(null)
      return
    }
    setImportLoading(true)
    setImportError(null)
    setImportSuccess(null)
    try {
      const raw = await importFile.text()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        setImportError(t('programs.import.invalidShape'))
        return
      }
      await api.post(`/communities/${communityCode}/programs/import`, parsed)
      setImportFile(null)
      setImportSuccess(t('programs.import.success'))
      await onRefreshPrograms?.()
    } catch (err: any) {
      const message = err?.message || t('programs.import.error')
      setImportError(message)
    } finally {
      setImportLoading(false)
    }
  }

  return (
    <div className="stack">
      {/*<h4>{t('tab.programs')}</h4>
      <p className="muted">{t('programs.subtitle')}</p>*/}
      {programError && <div className="badge negative">{programError}</div>}
      <div className="card soft">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="muted">{t('programs.import.title')}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t('programs.import.subtitle')}</div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {importError && <span className="badge negative">{importError}</span>}
            {importSuccess && <span className="badge positive">{importSuccess}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <input
            className="input"
            type="file"
            accept="application/json"
            onChange={(e) => {
              setImportFile(e.target.files?.[0] || null)
              setImportError(null)
              setImportSuccess(null)
            }}
          />
          <button className="btn primary small" type="button" onClick={handleImportPrograms} disabled={importLoading}>
            {importLoading ? t('programs.import.loading') : t('programs.import.button')}
          </button>
        </div>
      </div>
      {!programError && programs.length > 0 ? (
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }} role="tablist">
            {programs.map((p: any) => {
              const label = p.name || p.code
              const isActive = p.code === activeCode
              return (
                <button
                  key={p.code}
                  type="button"
                  className="btn secondary"
                  onClick={() => setActiveCode(p.code)}
                  role="tab"
                  aria-selected={isActive}
                  style={{
                    padding: '8px 12px',
                    background: isActive ? 'rgba(43,212,213,0.15)' : undefined,
                    borderColor: isActive ? 'rgba(43,212,213,0.5)' : undefined,
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {activeProgram && (
            <div className="stack">
              <ProgramDetails program={activeProgram} />
              <div className="card soft">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="muted">{t('programs.ledger', 'Ledger')}</div>
                    <strong>
                      {t('programs.balance', 'Balance')}: {balance.toFixed(2)}{' '}
                      {ledger?.summary?.currency || activeProgram.currency || 'RON'}
                    </strong>
                  </div>
                  {ledgerLoading && <div className="muted">{t('communities.loading', 'Loading...')}</div>}
                  {ledgerError && <div className="badge negative">{ledgerError}</div>}
                </div>
                {!ledgerLoading && !ledgerError && ledger && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <span className="pill-tight">
                        {t('programs.inflow', 'Inflow')}: {Number(ledger.summary.inflow).toFixed(2)}
                      </span>
                      <span className="pill-tight">
                        {t('programs.outflow', 'Outflow')}: {Number(ledger.summary.outflow).toFixed(2)}
                      </span>
                      <span className="pill-tight">
                        {t('programs.entries', 'Entries')}: {ledger.summary.lineCount}
                      </span>
                    </div>
                    {ledger.byKind?.length > 0 && (
                      <div>
                        <div className="muted">{t('programs.byKind', 'By kind')}</div>
                        <ul className="muted" style={{ marginTop: 4 }}>
                          {ledger.byKind.map((k) => (
                            <li key={k.kind}>
                              {k.kind}: {Number(k.total).toFixed(2)} ({k.count})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <div className="muted">{t('programs.recent', 'Recent')}</div>
                      <ul className="muted" style={{ marginTop: 4 }}>
                        {ledger.recent.length > 0 ? (
                          ledger.recent.map((le) => (
                            <li key={le.id || `${le.createdAt}-${le.refId}`}>
                              <span style={{ fontWeight: 600 }}>{Number(le.amount || 0).toFixed(2)}</span>{' '}
                              {le.currency || ledger.summary.currency || activeProgram.currency || 'RON'} •{' '}
                              {le.kind || 'ENTRY'} {le.createdAt ? `• ${new Date(le.createdAt).toLocaleDateString()}` : ''}
                            </li>
                          ))
                        ) : (
                          <li>{t('programs.noLedger', 'No ledger entries')}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
              <div className="card soft">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="muted">{t('programs.invoices', 'Invoices')}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t('programs.linkHelp', 'Link vendor invoices to this program')}</div>
                  </div>
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    {invLoading && <div className="muted">{t('communities.loading', 'Loading...')}</div>}
                    {invError && <div className="badge negative">{invError}</div>}
                    {!invLoaded && (
                      <button
                        type="button"
                        className="btn secondary small"
                        onClick={() => fetchInvoices()}
                        disabled={invLoading}
                      >
                        {t('programs.loadInvoices', 'Link invoice to program')}
                      </button>
                    )}
                    {invLoaded && (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => fetchInvoices()}
                        disabled={invLoading}
                      >
                        {t('programs.reloadInvoices', 'Reload invoices')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="stack" style={{ marginTop: 8 }}>
                  {!invLoaded && (
                    <div className="muted">{t('programs.loadInvoicesHint', 'Load invoices to link them to this program.')}</div>
                  )}
                  {invLoaded && (
                    <>
                  <div className="card soft" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>{t('programs.addInvoice', 'Add invoice')}</strong>
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => setShowNewInvoice((v) => !v)}
                      >
                        {showNewInvoice ? t('programs.hideForm', 'Hide form') : t('programs.showForm', 'Show form')}
                      </button>
                    </div>
                    {showNewInvoice && (
                      <form className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }} onSubmit={handleCreateInvoice}>
                        <input
                          className="input"
                          style={{ minWidth: 160 }}
                          placeholder={t('programs.vendor', 'Vendor')}
                          value={newInv.vendorName}
                          onChange={(e) => setNewInv((s) => ({ ...s, vendorName: e.target.value }))}
                          required
                        />
                        <input
                          className="input"
                          style={{ minWidth: 140 }}
                          placeholder={t('programs.number', 'Number')}
                          value={newInv.number}
                          onChange={(e) => setNewInv((s) => ({ ...s, number: e.target.value }))}
                          required
                        />
                        <input
                          className="input"
                          style={{ width: 120 }}
                          type="number"
                          step="0.01"
                          placeholder={t('programs.gross', 'Gross')}
                          value={newInv.gross}
                          onChange={(e) => setNewInv((s) => ({ ...s, gross: e.target.value }))}
                        />
                        <input
                          className="input"
                          style={{ width: 100 }}
                          placeholder={t('programs.currency', 'Currency')}
                          value={newInv.currency}
                          onChange={(e) => setNewInv((s) => ({ ...s, currency: e.target.value }))}
                        />
                        <input
                          className="input"
                          style={{ width: 160 }}
                          type="date"
                          value={newInv.issueDate}
                          onChange={(e) => setNewInv((s) => ({ ...s, issueDate: e.target.value }))}
                        />
                        <button className="btn primary small" type="submit" disabled={creating}>
                          {t('programs.saveInvoice', 'Save invoice')}
                        </button>
                      </form>
                    )}
                  </div>

                  {linkedInvoiceMap.size === 0 && (
                    <div className="muted">{t('programs.noLinkedInvoices', 'No linked invoices')}</div>
                  )}
                  {Array.from(linkedInvoiceMap.entries()).map(([invId, links]) => {
                    const inv = invoices.find((x) => x.id === invId)
                    return (
                      <div
                        key={invId}
                        className="row"
                        style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '6px 0' }}
                      >
                        <div>
                          <strong>{inv?.number || invId}</strong>{' '}
                          {inv?.vendor?.name && <span className="muted">• {inv.vendor.name}</span>}{' '}
                          {inv?.gross != null && (
                            <span className="muted">
                              • {inv.gross} {inv.currency || 'RON'}
                            </span>
                          )}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {links.map((l, idx) => (
                              <span key={`${invId}-${l.portionKey ?? 'default'}-${idx}`} style={{ marginRight: 8 }}>
                                {t('programs.linkedPortion', 'Portion')}: {l.amount ?? inv?.gross ?? ''}{' '}
                                <button
                                  className="btn ghost small"
                                  style={{ padding: '4px 8px' }}
                                  onClick={() => handleUnlink(invId, l.portionKey)}
                                  disabled={linking}
                                >
                                  {t('programs.unlink', 'Unlink')}
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                <form
                  className="row"
                  style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                  onSubmit={handleLink}
                >
                  <select
                    className="input"
                    style={{
                      minWidth: 220,
                      color: 'var(--text)',
                      background: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                    value={linkInvoiceId}
                    onChange={(e) => setLinkInvoiceId(e.target.value)}
                  >
                    <option value="">{t('programs.selectInvoice', 'Select invoice')}</option>
                    {availableInvoices.map((inv) => {
                        const links = linkedInvoiceMap.get(inv.id) || []
                        const linkedSum = links.reduce((s, l) => s + Number(l.amount ?? 0), 0)
                        const gross = inv.gross != null ? Number(inv.gross) : null
                        const remaining = gross != null ? Math.max(gross - linkedSum, 0) : null
                        return (
                          <option key={inv.id} value={inv.id}>
                            {inv.number || inv.id} {inv.vendor?.name ? `• ${inv.vendor.name}` : ''}{' '}
                            {inv.gross != null ? `• ${inv.gross} ${inv.currency || 'RON'}` : ''}
                            {remaining != null ? ` • ${t('programs.remaining', 'Remaining')}: ${remaining.toFixed(2)}` : ''}
                          </option>
                        )
                      })}
                      {availableInvoices.length === 0 && (
                        <option value="" disabled>
                          {t('programs.noAvailableInvoices', 'No invoices available')}
                        </option>
                      )}
                    </select>
                    <input
                      className="input"
                      style={{ width: 120 }}
                      type="number"
                      step="0.01"
                      placeholder={t('programs.amount', 'Amount')}
                      value={linkAmount}
                      onChange={(e) => setLinkAmount(e.target.value)}
                    />
                    <input
                      className="input"
                      style={{ width: 140 }}
                      type="text"
                      placeholder={t('programs.portion', 'Portion key')}
                      value={linkPortionKey}
                      onChange={(e) => setLinkPortionKey(e.target.value)}
                    />
                    <button className="btn primary small" type="submit" disabled={!linkInvoiceId || linking}>
                      {t('programs.linkInvoice', 'Link invoice')}
                    </button>
                  </form>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card soft">
          <div className="muted">{t('programs.label')}</div>
          <p className="muted">{t('programs.loadPrompt')}</p>
        </div>
      )}
    </div>
  )
}
