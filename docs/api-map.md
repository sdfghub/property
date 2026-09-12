# API map — every route, grouped by module

Generated from `@Controller` / verb decorators in `src/modules/**/*.controller.ts` (regenerate with the
snippet at the bottom). All routes sit under `/api`, require a JWT, and are scoped with `@Scopes` —
see [system-overview.md](./system-overview.md#request-lifecycle). Community routes accept the
community id or code.

## `auth`

| Verb | Path |
|---|---|
| POST | `/api/auth/register` |
| POST | `/api/auth/login` |
| POST | `/api/auth/oauth` |
| POST | `/api/auth/refresh` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/forgot-password` |
| POST | `/api/auth/reset-password` |
| POST | `/api/auth/revoke-all` |

## `be-financials`

| Verb | Path |
|---|---|
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations/aggregate` |
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations/drill/member/:unitId` |
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations/drill/split-group/:splitGroupId` |
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations/drill/detail/:unitId/:splitGroupId` |
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations/detail` |

## `billing`

| Verb | Path |
|---|---|
| GET | `/api/communities/be/:beId/periods/closed` |
| GET | `/api/communities/be/:beId/periods` |
| GET | `/api/communities/be/:beId/periods/:periodCode/allocations` |
| GET | `/api/communities/be/:beId/periods/:periodCode/financials` |
| GET | `/api/communities/be/:beId/statements` |
| GET | `/api/communities/be/:beId/summary` |
| GET | `/api/communities/be/:beId/dashboard` |
| GET | `/api/communities/:communityId/cash-accounts` |
| GET | `/api/communities/:communityId/cash-accounts/balances` |
| POST | `/api/communities/:communityId/cash-accounts` |
| GET | `/api/communities/:communityId/cash-tx` |
| POST | `/api/communities/:communityId/cash-tx` |
| POST | `/api/communities/:communityId/cash-accounts/:accountId/opening` |
| GET | `/api/communities/:communityId/cash-accounts/openings` |
| GET | `/api/communities/:communityId/periods/:periodCode/billing-entities` |
| GET | `/api/communities/:communityId/periods/:periodCode/billing-entities/:beCode` |
| GET | `/api/communities/:communityId/periods/:periodCode/billing-entities/:beCode/allocations` |
| GET | `/api/communities/:communityId/periods/:periodCode/billing-entities/:beCode/members/:unitCode/allocations` |
| GET | `/api/communities/:communityId/current-due` |
| POST | `/api/communities/:communityId/expense-types` |
| GET | `/api/me/communities/:communityId/periods/:periodCode/meters` |
| POST | `/api/me/communities/:communityId/periods/:periodCode/meters` |
| POST | `/api/me/payments` |
| GET | `/api/me/communities/:communityId/capabilities` |
| GET | `/api/me/communities/:communityId/avizier` |
| GET | `/api/me/communities/:communityId/association-info` |
| GET | `/api/me/communities/:communityId/collection-rate` |
| GET | `/api/me/communities/:communityId/vendor-invoices/unpaid` |
| GET | `/api/me/communities/:communityId/funds` |
| GET | `/api/me/communities/:communityId/funds/:fundId/ledger` |
| GET | `/api/communities/:communityId/measure-modes` |
| POST | `/api/communities/:communityId/measure-modes` |
| GET | `/api/communities/:communityId/payment-allocation` |
| POST | `/api/communities/:communityId/payment-allocation` |
| GET | `/api/communities/:communityId/payments` |
| GET | `/api/communities/:communityId/payments/open-charges` |
| GET | `/api/communities/:communityId/payments/:id` |
| POST | `/api/communities/:communityId/payments` |
| POST | `/api/communities/:communityId/payments/intent` |
| POST | `/api/communities/:communityId/payments/:id/confirm` |
| POST | `/api/communities/:communityId/payments/:id/apply` |
| GET | `/api/communities/:communityId/periods/:periodCode/bill-templates` |
| GET | `/api/communities/:communityId/periods/:periodCode/expenses/status` |
| GET | `/api/communities/:communityId/periods/:periodCode/expenses` |
| POST | `/api/communities/:communityId/periods/:periodCode/bill-templates` |
| POST | `/api/communities/:communityId/periods/:periodCode/bill-templates/:code/state` |
| POST | `/api/communities/:communityId/bill-templates/import` |
| GET | `/api/communities/:communityId/periods/:periodCode/bill-templates/:code/attachments` |
| POST | `/api/communities/:communityId/periods/:periodCode/bill-templates/:code/attachments` |
| DELETE | `/api/communities/:communityId/periods/:periodCode/bill-templates/:code/attachments/:id` |
| GET | `/api/communities/:communityId/periods/:periodCode/bill-templates/:code/attachments/:id/download` |
| GET | `/api/communities/:communityId/periods/:periodCode/meter-templates` |
| POST | `/api/communities/:communityId/periods/:periodCode/meter-templates` |
| POST | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/state` |
| POST | `/api/communities/:communityId/meter-templates/import` |
| GET | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/attachments` |
| POST | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/attachments` |
| DELETE | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/attachments/:id` |
| GET | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/attachments/:id/download` |
| GET | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/csv` |
| POST | `/api/communities/:communityId/periods/:periodCode/meter-templates/:code/csv` |
| GET | `/api/communities/:communityId/meters/:meterId/history` |
| GET | `/api/communities/:communityId/periods/:periodCode/meters/:meterId` |
| POST | `/api/communities/:communityId/periods/:periodCode/meters` |
| GET | `/api/me/dashboard` |
| GET | `/api/me/communities/:communityId/dashboard` |
| GET | `/api/communities/:communityId/invoices` |
| GET | `/api/communities/:communityId/invoices/summary` |
| GET | `/api/communities/:communityId/invoices/:id` |
| POST | `/api/communities/:communityId/invoices` |
| PATCH | `/api/communities/:communityId/invoices/:id` |
| POST | `/api/communities/:communityId/invoices/:id/fund-links` |
| POST | `/api/communities/:communityId/invoices/:id/fund-links/remove` |
| POST | `/api/communities/:communityId/invoices/:id/payments` |
| POST | `/api/communities/:communityId/invoices/:id/settle-at-cutover` |
| POST | `/api/communities/:communityId/invoices/opening-payments` |
| PATCH | `/api/communities/:communityId/invoices/:id/payments/:paymentId` |
| DELETE | `/api/communities/:communityId/invoices/:id/payments/:paymentId` |
| GET | `/api/communities/:communityId/invoices` |
| POST | `/api/communities/:communityId/invoices` |
| PATCH | `/api/communities/:communityId/invoices/:vendorId` |

## `committee`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/committee/decisions` |
| POST | `/api/communities/:communityId/committee/decisions` |
| POST | `/api/communities/:communityId/committee/decisions/:id/vote` |
| POST | `/api/communities/:communityId/committee/decisions/:id/cancel` |

## `communications`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/announcements` |
| GET | `/api/communities/:communityId/announcements/:announcementId` |
| POST | `/api/communities/:communityId/announcements` |
| PATCH | `/api/communities/:communityId/announcements/:announcementId` |
| POST | `/api/communities/:communityId/announcements/:announcementId/cancel` |

## `community`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/units` |
| POST | `/api/communities/:communityId/units` |
| GET | `/api/communities/:communityId/unit-groups` |
| POST | `/api/communities/:communityId/unit-groups` |
| POST | `/api/communities/:communityId/unit-groups/:groupId/members` |
| GET | `/api/communities/:communityId/billing-entities` |
| GET | `/api/communities/:communityId/billing-entities/detailed` |
| GET | `/api/communities/:communityId/unit-groups/detailed` |
| GET | `/api/communities/:communityId/tenants` |
| POST | `/api/communities/:communityId/tenants` |
| PATCH | `/api/communities/:communityId/tenants/:tenantId` |
| DELETE | `/api/communities/:communityId/tenants/:tenantId` |
| PATCH | `/api/communities/:communityId/units/:unitCode/property-manager` |
| PATCH | `/api/communities/:communityId/billing-entities/:code/primary-owner` |
| POST | `/api/communities/:communityId/tenants/detect` |
| POST | `/api/communities/:communityId/billing-entities` |
| PATCH | `/api/communities/:communityId/billing-entities/:beCode/display-name` |
| POST | `/api/communities/:communityId/billing-entities/:beCode/rename` |
| POST | `/api/communities/:communityId/billing-entities/:beId/members` |
| GET | `/api/communities/:communityId/allocation-rules` |
| POST | `/api/communities/:communityId/allocation-rules` |
| GET | `/api/communities/:communityId/split-groups` |
| POST | `/api/communities/:communityId/split-groups` |
| POST | `/api/communities/:communityId/split-groups/:splitGroupId/members` |
| GET | `/api/communities/:communityId/derived-meter-rules` |
| POST | `/api/communities/:communityId/derived-meter-rules` |
| GET | `/api/communities/:communityId/aggregation-rules` |
| POST | `/api/communities/:communityId/aggregation-rules` |
| GET | `/api/communities/:communityId/meters` |
| POST | `/api/communities/:communityId/meters` |
| GET | `/api/communities` |
| GET | `/api/communities/scopes` |
| POST | `/api/communities` |
| GET | `/api/communities/:communityId/admins` |
| DELETE | `/api/communities/:communityId/admins/:userId` |
| GET | `/api/communities/:communityId/roles` |
| GET | `/api/communities/:communityId/settings` |
| PATCH | `/api/communities/:communityId/settings` |
| GET | `/api/communities/:communityId/association-info` |
| PATCH | `/api/communities/:communityId/association-info` |
| DELETE | `/api/communities/:communityId/roles/:userId/:role` |
| GET | `/api/communities/:communityId/billing-entities/responsibles` |
| PATCH | `/api/communities/:communityId/billing-entities/:beId/users/:userId/roles` |
| GET | `/api/community-config/:communityCode` |
| GET | `/api/community-config/:communityCode/meters` |
| GET | `/api/community-config/:communityCode/template-coverage` |
| GET | `/api/community-config/:communityCode/meters-config` |
| GET | `/api/communities/:communityId/dashboard` |
| GET | `/api/community-funds/:communityCode` |
| POST | `/api/admin/communities/import` |
| POST | `/api/admin/communities/:communityId/wipe` |
| POST | `/api/admin/opening-balances` |
| POST | `/api/admin/opening-balances/units` |
| GET | `/api/communities/public` |

## `corrections`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/corrections` |
| GET | `/api/communities/:communityId/corrections/context` |
| GET | `/api/communities/:communityId/corrections/:id/ledger` |
| POST | `/api/communities/:communityId/corrections` |
| POST | `/api/communities/:communityId/corrections/:id/void` |

## `engagement`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/events` |
| GET | `/api/communities/:communityId/events/:eventId` |
| POST | `/api/communities/:communityId/events` |
| PATCH | `/api/communities/:communityId/events/:eventId` |
| DELETE | `/api/communities/:communityId/events/:eventId` |
| POST | `/api/communities/:communityId/events/:eventId/rsvp` |
| GET | `/api/communities/:communityId/polls` |
| GET | `/api/communities/:communityId/polls/:pollId` |
| POST | `/api/communities/:communityId/polls` |
| PATCH | `/api/communities/:communityId/polls/:pollId` |
| POST | `/api/communities/:communityId/polls/:pollId/approve` |
| POST | `/api/communities/:communityId/polls/:pollId/reject` |
| POST | `/api/communities/:communityId/polls/:pollId/close` |
| POST | `/api/communities/:communityId/polls/:pollId/publish-results` |
| POST | `/api/communities/:communityId/polls/:pollId/vote` |

## `features`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/features/registry` |
| GET | `/api/communities/:communityId/features` |
| POST | `/api/communities/:communityId/features` |

## `finance`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/finance/receivables` |
| GET | `/api/communities/:communityId/finance/vendor-invoices/unpaid` |
| GET | `/api/communities/:communityId/finance/funds-status` |
| GET | `/api/communities/:communityId/finance/avizier` |
| GET | `/api/communities/:communityId/finance/avizier/expenses` |
| GET | `/api/communities/:communityId/finance/avizier-config` |
| PATCH | `/api/communities/:communityId/finance/avizier-config` |
| GET | `/api/communities/:communityId/finance/avizier-config/context` |
| GET | `/api/communities/:communityId/finance/expense-catalog` |
| GET | `/api/communities/:communityId/finance/avizier/explain` |
| GET | `/api/communities/:communityId/finance/avizier/explain-sold` |
| GET | `/api/communities/:communityId/finance/avizier/payments` |
| GET | `/api/communities/:communityId/finance/avizier/adjustments` |
| POST | `/api/communities/:communityId/finance/avizier/charge-override` |
| GET | `/api/communities/:communityId/finance/penalties` |
| GET | `/api/communities/:communityId/finance/avizier/charge-override` |
| GET | `/api/communities/:communityId/finance/avizier/explain-penalty` |
| GET | `/api/communities/:communityId/finance/collection` |

## `fund`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/funds` |
| GET | `/api/communities/:communityId/funds/:fundId/invoices` |
| GET | `/api/communities/:communityId/funds/:fundId/ledger` |
| POST | `/api/communities/:communityId/funds/import` |
| POST | `/api/communities/:communityId/funds` |
| PATCH | `/api/communities/:communityId/funds/:fundId` |

## `intake`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/intake/prompt` |
| GET | `/api/communities/:communityId/intake/hints` |
| POST | `/api/communities/:communityId/intake/hints` |
| GET | `/api/communities/:communityId/intake/context` |
| GET | `/api/communities/:communityId/intake/batches` |
| POST | `/api/communities/:communityId/intake/batches` |
| POST | `/api/communities/:communityId/intake/batches/check` |
| GET | `/api/communities/:communityId/intake/batches/:batchId` |
| POST | `/api/communities/:communityId/intake/batches/:batchId/recheck` |
| PATCH | `/api/communities/:communityId/intake/batches/:batchId/records/:recordId` |
| POST | `/api/communities/:communityId/intake/batches/:batchId/apply` |
| DELETE | `/api/communities/:communityId/intake/batches/:batchId` |

## `inventory`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/inventory/assets` |
| POST | `/api/communities/:communityId/inventory/assets` |
| POST | `/api/communities/:communityId/inventory/assets/:assetId/rules` |
| GET | `/api/communities/:communityId/inventory/rules` |
| POST | `/api/communities/:communityId/inventory/rules/:ruleId/run` |

## `invite`

| Verb | Path |
|---|---|
| POST | `/api/invites` |
| POST | `/api/invites/community/:communityId` |
| GET | `/api/invites/community/:communityId/pending` |
| DELETE | `/api/invites/community/:communityId/pending/:inviteId` |
| GET | `/api/invites/billing-entity/:beId/pending` |
| DELETE | `/api/invites/billing-entity/:beId/pending/:inviteId` |
| GET | `/api/invites/:token` |
| POST | `/api/invites/claim` |

## `metadata`

| Verb | Path |
|---|---|
| GET | `/api/metadata` |

## `notifications`

| Verb | Path |
|---|---|
| GET | `/api/notification-preferences` |
| PATCH | `/api/notification-preferences` |
| GET | `/api/notifications` |
| POST | `/api/notifications/:notificationId/read` |

## `notifications-jobs`

| Verb | Path |
|---|---|
| POST | `/api/admin/notifications/process-deliveries` |

## `period`

| Verb | Path |
|---|---|
| POST | `/api/communities/:communityId/periods/:periodCode/prepare` |
| POST | `/api/communities/:communityId/periods/:periodCode/approve` |
| POST | `/api/communities/:communityId/periods/:periodCode/recompute` |
| POST | `/api/communities/:communityId/periods/:periodCode/due-date` |
| GET | `/api/communities/:communityId/periods/:periodCode/summary` |
| GET | `/api/communities/:communityId/periods/:periodCode/status` |
| GET | `/api/communities/:communityId/periods/:periodCode/settings` |
| POST | `/api/communities/:communityId/periods/:periodCode/settings` |
| GET | `/api/communities/:communityId/periods/:periodCode/checklist` |
| POST | `/api/communities/:communityId/periods/:periodCode/checklist` |
| GET | `/api/communities/:communityId/periods/:periodCode/unit-attributes` |
| POST | `/api/communities/:communityId/periods/:periodCode/unit-attributes` |
| POST | `/api/communities/:communityId/periods/:periodCode/reject` |
| POST | `/api/communities/:communityId/periods/:periodCode/reopen` |
| GET | `/api/communities/:communityId/periods/:periodCode/editable` |
| GET | `/api/communities/:communityId/periods/:periodCode` |
| GET | `/api/communities/:communityId/periods/:periodCode/closed` |
| GET | `/api/communities/:communityId/periods/:periodCode/open` |
| POST | `/api/communities/:communityId/periods/:periodCode/create` |

## `push`

| Verb | Path |
|---|---|
| GET | `/api/push-tokens` |
| POST | `/api/push-tokens` |
| DELETE | `/api/push-tokens/:id` |
| POST | `/api/push-tokens/test-send` |
| POST | `/api/push-tokens/admin-test-send` |

## `reports`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/reports/collection-rate` |
| GET | `/api/communities/:communityId/reports/risk` |

## `ticketing`

| Verb | Path |
|---|---|
| GET | `/api/communities/:communityId/tickets` |
| GET | `/api/communities/:communityId/tickets/:ticketId` |
| POST | `/api/communities/:communityId/tickets` |
| PATCH | `/api/communities/:communityId/tickets/:ticketId` |
| POST | `/api/communities/:communityId/tickets/:ticketId/status` |
| POST | `/api/communities/:communityId/tickets/:ticketId/comments` |

## Regenerate

```bash
python3 - <<'PY'
import re,glob,io
for f in sorted(glob.glob('src/modules/**/*.controller.ts', recursive=True)):
    s=io.open(f).read(); p=(re.search(r"@Controller\('([^']*)'\)", s) or [None,''])[1]
    for m in re.finditer(r"@(Get|Post|Patch|Put|Delete)\(('([^']*)')?\)", s): print(f.split('/')[2], m.group(1).upper(), '/api/'+'/'.join(x for x in [p, m.group(3) or ''] if x))
PY
```
