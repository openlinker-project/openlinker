# Pre-implement analysis: stored reason codes (#3866)

**Plan:** `docs/plans/implementation-plan-stored-reason-codes.md`
**Branch:** `3866-stored-reason-codes`, based on `3867-describe-api-error-renders` (#4072)
**Verdict:** **READY** (no Critical findings; three Warnings to fold in while implementing)

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `WebhookDlqCode` union + `readWebhookDlqCode` | NEW | no match in `libs` / `apps` |
| `webhook_deliveries.dlqCode` column | NEW | `webhook-delivery.orm-entity.ts` has `dlqReason` only |
| unroutable routing `code` | PARTIAL | `apps/api/src/webhooks/application/types/inbound-webhook-routing.types.ts:32` (`{ kind: 'unroutable'; reason: string }`); the five prefixes are already fixed in `inbound-webhook-routing.service.ts` |
| `SalesDocumentBlockParams` + `SalesDocumentBlock.params` | NEW / PARTIAL | `SalesDocumentBlock` exists in `libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts:200`; extend it there (the leaf has zero sibling edges, params must stay ids / counts / codes) |
| `order_records.salesDocumentBlockParams` column | NEW | ORM has `salesDocumentBlockReason` / `UnresolvedReason` / `Detail` |
| routed-connection state code | PARTIAL | `describeRoutedConnectionState` returns phrases (`'no longer exists'`, `CONNECTION_STATE_PHRASE[status]`, `does not have X enabled`); turn its branches into a code + the existing phrase for `detail` |
| missing-tax-rate params | EXISTS -> reuse | `MissingTaxRateFinding` already carries `scope`, `lineCount`, `totalLines`, `firstLineRef` (`order-tax-rate-gate.types.ts`) |
| `ConnectionTestOutcome` + `resolveConnectionTestOutcome` | NEW | `connection-test.types.ts` has no outcome |
| operational-settings error `rule` / `limit` | PARTIAL | `InvalidOperationalSettingError` carries `field` only; `checkOperationalSettingBound` returns a string - make it return a structured result (or add `rule` / `limit` to the error) |
| FE `boundReasons.<key>` copy | NEW | FE reads `recommendedReason` / `absoluteReason` in `resolve-value-limits.ts`, `pacing-value-field.tsx`, `sync-pacing-changes.ts` |
| `ui.apiError.technicalDetailsWith` | EXISTS -> reuse | added by #4072; use it for every raw fallback |

## Backward-compatibility findings

**Critical:** none.

- `ConnectionTestResult` (exported from `@openlinker/core/integrations`, implemented by 12 in-tree testers and any
  out-of-tree plugin): the plan adds an **optional** `outcome`, which is source-compatible. `ConnectionTestResultDto`
  gains a response field - additive. The FE type in `connections.types.ts` must follow.
- `SalesDocumentBlock`: optional `params` is additive; `OrderRecordRepositoryPort.updateSalesDocumentBlock(orderId,
  block)` keeps its signature.
- Webhook delivery DTOs: `dlqCode` is an added response field. `dlqReason` stays (the e2e suite reads it,
  `apps/e2e/src/api/api.types.ts:725`).
- Order DTO: `salesDocumentBlockDetail` stays (e2e reads it: `tests/invoicing/sales-document-block.spec.ts:82`,
  `tests/subiekt/order-to-documents.spec.ts:421`); `salesDocumentBlockParams` is added.
- Operational-settings response keeps `recommendedReason` / `absoluteReason` (decided option A).

**Warnings**

1. **Migrations (2).** Next synthetic timestamps must sort above `origin/main`'s newest,
   `1938400000000-add-login-page-settings` (e.g. `1938410000000`, `1938420000000`), class suffix matching
   (`check-migration-timestamps.mjs`). The dlqCode backfill must restrict to the five known prefixes; `down()`
   drops each column. Run `migration:show`.
2. **Frontend mirrors need a mirror check.** The FE will hold copies of `WebhookDlqCode`, `ConnectionTestOutcome` and
   the routed-connection state codes (`apps/web` cannot import core, #591). The repo's established pattern is a
   `scripts/check-*-mirror.mjs` under `check:invariants` (20+ exist, e.g. `check-destination-routing-reason-mirror.mjs`,
   `check-fiscal-reconcile-outcome-mirror.mjs`). The plan has none - add one per mirrored union (or one script for
   all three), failing on value drift and on a code with no EN copy.
3. **Test doubles.** `apps/worker/src/testing/operational-settings.double.ts` copies the bound reasons; FE
   `resolve-value-limits.test.ts` asserts the server reason is read. Both change with step 3.

## Open questions

- None blocking. The deferred success-detail question (plan § 5.2) does not affect this change.
