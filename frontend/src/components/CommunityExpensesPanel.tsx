// Expenses tab: manage per-period expenses and quick-add missing expense types.
import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../i18n/useI18n'
import { BillForm, BillTemplate } from './bills/BillForm'
import { BillTemplatesHost } from './bills/BillTemplatesHost'

export function CommunityExpensesPanel({
  communityId,
  onBillStatusChange,
}: {
  communityId: string
  onBillStatusChange?: (summary: { total: number; closed: number }) => void
}) {
  const { api } = useAuth()
  const { t } = useI18n()
  const [openPeriods, setOpenPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [periods, setPeriods] = React.useState<Array<{ id: string; code: string }>>([])
  const [periodCode, setPeriodCode] = React.useState('')
  const [expenseTypes, setExpenseTypes] = React.useState<
    Array<{ id: string; code: string; name: string; currency?: string | null; hasExpense?: boolean; amount?: number | null }>
  >([])
  const [expenses, setExpenses] = React.useState<Array<{ id: string; description: string; allocatableAmount: number; currency: string; expenseType?: { code: string; name: string } | null }>>([])
  const [expenseForm, setExpenseForm] = React.useState<{
    description: string
    amount: string
    expenseTypeId?: string
    currency?: string
    allocationMethod?: string
    allocationParams?: string
  }>({ description: '', amount: '', expenseTypeId: undefined, currency: 'RON' })
  const [expenseComplete, setExpenseComplete] = React.useState(false)
  const [quickAmounts, setQuickAmounts] = React.useState<Record<string, string>>({})
  const [quickAddOpen, setQuickAddOpen] = React.useState<Record<string, boolean>>({})
  const [showCustomForm, setShowCustomForm] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [editable, setEditable] = React.useState<{ period?: { code: string; status: string }; meters?: any; bills?: any; canClose?: boolean } | null>(null)
  const editablePeriod = editable?.period?.code || openPeriods[0]?.code || ''
  const canEdit = periodCode === editablePeriod && !!editablePeriod

  React.useEffect(() => {
    if (editable?.period?.code && editable?.period?.status !== 'CLOSED' && periodCode !== editable.period.code) {
      setPeriodCode(editable.period.code)
    }
  }, [editable?.period?.code, editable?.period?.status])

  React.useEffect(() => {
    if (!communityId) return
    setMessage(null)
    api
      .get<any>(`/communities/${communityId}/periods/editable`)
      .then((res) => {
        if (res?.period?.code) {
          setPeriodCode(res.period.code)
          setEditable(res)
        }
      })
      .catch(() => null)
    api
      .get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/open`)
      .then((rows) => {
        setOpenPeriods(rows)
        if (rows.length) {
          setPeriodCode(rows[0].code)
        }
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))

    api
      .get<Array<{ id: string; code: string }>>(`/communities/${communityId}/periods/closed`)
      .then((rows) => {
        setPeriods(rows)
        if (!openPeriods.length && rows.length && !periodCode) setPeriodCode(rows[0].code)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load periods'))
  }, [api, communityId])

  React.useEffect(() => {
    if (!communityId) return
    const code = periodCode || openPeriods[0]?.code || periods[0]?.code
    if (!code) return
    if (!periodCode && code) setPeriodCode(code)
    api
      .get<{ period: any; types: typeof expenseTypes; complete: boolean }>(
        `/communities/${communityId}/periods/${code}/expenses/status`,
      )
      .then((res) => {
        setExpenseTypes(res.types || [])
        setExpenseComplete(res.complete)
      })
      .catch((err: any) => setMessage(err?.message || 'Could not load expense types'))
  }, [api, communityId, periodCode, periods, openPeriods])

  React.useEffect(() => {
    if (!communityId || !periodCode) return
    api
      .get<{ items: typeof expenses }>(`/communities/${communityId}/periods/${periodCode}/expenses`)
      .then((res) => setExpenses(res.items || []))
      .catch((err: any) => setMessage(err?.message || 'Could not load expenses'))
  }, [api, communityId, periodCode])

  return (
    <div className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
      {communityId && periodCode ? (
        <BillTemplatesHost
          communityId={communityId}
          periodCode={periodCode}
          canEdit={canEdit}
          onStatusChange={onBillStatusChange}
        />
      ) : null}

      {/* Quick add panel for missing expense types so admins can fill the template fast. */}
      {!expenseComplete && expenseTypes.some((et) => !et.hasExpense && quickAddOpen[et.id]) && (
        <div className="grid two" style={{ marginTop: 12, gap: 10 }}>
          {expenseTypes
            .filter((et) => !et.hasExpense && quickAddOpen[et.id])
            .map((et) => (
              <div key={et.id} className="card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{et.code}</strong> — {et.name}
                    <div className="muted">{et.currency || 'RON'}</div>
                  </div>
                  <div className="badge warn">{t('exp.missingSuffix')}</div>
                </div>
                <label className="label">
                  <span>{t('exp.amount')}</span>
                  <span className="muted">{t('billing.periodBadge', { code: periodCode || openPeriods[0]?.code || periods[0]?.code || '' })}</span>
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={quickAmounts[et.id] ?? ''}
                    onChange={(e) => setQuickAmounts((prev) => ({ ...prev, [et.id]: e.target.value }))}
                  />
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      if (!communityId || !periodCode) return
                      const amt = quickAmounts[et.id]
                      if (amt === undefined || amt === null || amt === '') return
                      api
                        .post('/communities/' + communityId + '/periods/' + periodCode + '/expenses', {
                          description: et.name,
                          amount: Number(amt),
                          currency: et.currency || 'RON',
                          expenseTypeId: et.id,
                        })
                        .then(() =>
                          Promise.all([
                            api.get<{ items: typeof expenses }>(`/communities/${communityId}/periods/${periodCode}/expenses`),
                            api.get<{ types: typeof expenseTypes; complete: boolean }>(
                              `/communities/${communityId}/periods/${periodCode}/expenses/status`,
                            ),
                          ]),
                        )
                        .then(([expRes, statusRes]) => {
                          setExpenses(expRes.items || [])
                          setExpenseTypes(statusRes.types || [])
                          setExpenseComplete(statusRes.complete)
                          setQuickAmounts((prev) => ({ ...prev, [et.id]: '' }))
                        })
                        .catch((err: any) => setMessage(err?.message || 'Could not add expense'))
                    }}
                  >
                    {t('exp.add')}
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setShowCustomForm((prev) => !prev)}
          style={{ marginBottom: showCustomForm ? 10 : 0 }}
        >
          {showCustomForm ? 'Hide custom expense' : 'Add a custom expense'}
        </button>

        {showCustomForm && (
          <form
            className="grid two"
            style={{ gap: 10, marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (!communityId || !periodCode) return
              api
                .post('/communities/' + communityId + '/periods/' + periodCode + '/expenses', {
                  description: expenseForm.description,
                  amount: Number(expenseForm.amount),
                  currency: expenseForm.currency,
                  expenseTypeId: expenseForm.expenseTypeId || undefined,
                  allocationMethod: expenseForm.allocationMethod || undefined,
                  allocationParams: expenseForm.allocationParams ? JSON.parse(expenseForm.allocationParams) : undefined,
                })
                .then(() => {
                  setExpenseForm({
                    description: '',
                    amount: '',
                    expenseTypeId: expenseForm.expenseTypeId,
                    currency: expenseForm.currency,
                    allocationMethod: expenseForm.allocationMethod,
                    allocationParams: '',
                  })
                  return Promise.all([
                    api.get<{ items: typeof expenses }>(`/communities/${communityId}/periods/${periodCode}/expenses`),
                    api.get<{ types: typeof expenseTypes; complete: boolean }>(
                      `/communities/${communityId}/periods/${periodCode}/expenses/status`,
                    ),
                  ])
                })
                .then(([exp, statusRes]) => {
                  setExpenses(exp.items || [])
                  setExpenseTypes(statusRes.types || [])
                  setExpenseComplete(statusRes.complete)
                })
                .catch((err: any) => setMessage(err?.message || 'Could not add expense'))
            }}
          >
            <div className="stack">
              <label className="label">
                <span>{t('exp.desc')}</span>
              </label>
              <input
                className="input"
                value={expenseForm.description}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, description: e.target.value }))}
                required
              />
            </div>
            <div className="stack">
              <label className="label">
                <span>{t('exp.amount')}</span>
              </label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={expenseForm.amount}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))}
                required
              />
            </div>
            <div className="stack">
              <label className="label">
                <span>{t('exp.type')}</span>
              </label>
              <select
                className="input"
                value={expenseForm.expenseTypeId ?? ''}
                onChange={(e) =>
                  setExpenseForm((prev) => ({
                    ...prev,
                    expenseTypeId: e.target.value || undefined,
                  }))
                }
              >
                <option value="">{t('exp.customType')}</option>
                {expenseTypes.map((et) => (
                  <option key={et.id} value={et.id}>
                    {et.code} — {et.name}
                  </option>
                ))}
              </select>
              <div className="stack" style={{ marginTop: 8 }}>
                <label className="label">
                  <span>Custom allocation method</span>
                  <span className="muted">Applied to this expense only</span>
                </label>
                <select
                  className="input"
                  value={expenseForm.allocationMethod || ''}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, allocationMethod: e.target.value || undefined }))}
                >
                  <option value="">(optional) Select method</option>
                  <option value="EQUAL">Equal</option>
                  <option value="BY_SQM">By sqm</option>
                  <option value="BY_RESIDENTS">By residents</option>
                  <option value="BY_CONSUMPTION">By consumption</option>
                  <option value="MIXED">Mixed</option>
                </select>
                <label className="label">
                  <span>Method params (JSON)</span>
                  <span className="muted">Optional, e.g. {"{\"weight\":0.5}"}</span>
                </label>
                <textarea
                  className="input"
                  rows={3}
                  value={expenseForm.allocationParams || ''}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, allocationParams: e.target.value }))}
                  placeholder='{}'
                />
              </div>
            </div>
            <div className="stack">
              <label className="label">
                <span>Currency</span>
              </label>
              <input
                className="input"
                value={expenseForm.currency || 'RON'}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, currency: e.target.value }))}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="btn" type="submit">
                {t('exp.add')}
              </button>
            </div>
          </form>
        )}
      </div>

      {message && <div className="badge negative">{message}</div>}
    </div>
  )
}
