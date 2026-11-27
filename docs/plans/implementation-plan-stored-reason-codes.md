# Implementation Plan: codes for stored and returned reasons (#3866)

## 1. Task understanding

**Goal.** Five fields reach the operator as English sentences with no code. After #3867 they are shown raw under
"Technical details (not translated)". Give each a stable code (and params) the frontend renders in the active
language; keep the English text only as a developer detail.

**Layer.** Backend (webhooks, invoicing auto-issue gate, operational settings, connection testers) + one migration
pair + frontend copy. No Polish on the backend.

**Base.** `3867-describe-api-error-renders` (#4072), the top of the error-code stack.

**Non-goals.**
- `sync_jobs.lastError` stays raw under the translated label (issue decision; #3867 already did it).
- Webhook `rejectionReason` (signature / timestamp refusals) is not listed in the issue; untouched.
- No change to what any gate decides - only how its reason is recorded and shown.

## 2. Fields

### 2.1 Webhook `dlqReason` -> `dlqCode` (migration 1)

`InboundWebhookRoutingService` already writes a fixed prefix: `connection-unavailable:`, `no-translator:`,
`translator-threw:`, `undecodable:`, `ungated:`.

- `WebhookDlqCodeValues` (as-const union) in `libs/core/src/webhooks/domain/types/`, plus a pure
  `readWebhookDlqCode(reason)` that maps a stored reason to its code (unknown prefix -> `null`).
- `unroutable` routing result gains `code: WebhookDlqCode`; `WebhookService` persists `dlqCode` beside `dlqReason`.
- Column `webhook_deliveries.dlqCode text NULL`; the migration backfills it from the prefix
  (`split_part("dlqReason", ':', 1)` restricted to the five known values). `down()` drops the column.
- DTO / entity / ORM / repository carry `dlqCode`. FE: list cell and detail panel show the translated code
  (`webhook-deliveries.dlqCodes.<code>`, EN + PL) and keep `dlqReason` in the detail page's raw panel.

### 2.2 Sales-document block `detail` -> `salesDocumentBlockParams` (migration 2)

The reason is already coded (`salesDocumentBlockReason` / `salesDocumentUnresolvedReason`); only `detail` is
English. Each writer in `auto-issue-trigger.service.ts` gets structured params next to its sentence:

| reason | params |
|---|---|
| `no-connection-declares-document-kind` | `candidateCount` |
| `ambiguous-connection-no-primary` | `eligibleCount`, `primaryCount`, `documentKind` (`invoice` / `fiscal-receipt` / `mixed`) |
| `routed-connection-unavailable` | `connectionId`, `ruleId?`, `documentKind`, `connectionState` (code, from `describeRoutedConnectionState`) |
| unrecognized document kind | `connectionId`, `documentKind` |
| invoice not supported | `connectionId` |
| `missing-tax-rate` | `scope`, `lineCount`, `totalLines`, `firstLineRef?` (already a structured finding) |
| `line-total-mismatch` | none - the detail is the mapper's sentence; stays raw under the label |

- `SalesDocumentBlockParams` type in `@openlinker/core/sales-documents` (PII-free: ids, counts, codes only),
  `SalesDocumentBlock` gains optional `params`; `OrderIngestionService` writes it with the reason
  (same single narrow writer, same level-triggered clear).
- Column `order_records.salesDocumentBlockParams jsonb NULL`; no backfill (old rows keep `detail`, which the FE
  shows raw under the label when `params` is absent). `down()` drops the column.
- Read path: entity, repository coercion (unknown shape -> `null`), sales-document view, order DTO.
- FE `sales-document-block.ts` composes the sentence from reason + params (`invoicing` / `orders` namespace,
  EN + PL); `detail` only as the raw fallback.

### 2.3 Operational-settings bound reasons -> copy per key in the FE

`recommendedReason` / `absoluteReason` are fixed per setting, so they need no code: the FE owns them as
`settings.operationalSettingsPage.boundReasons.<key>.{recommended,absolute}` (EN + PL) and stops reading the
server's strings. The API keeps sending them (developer documentation, no consumer breaks).
`OPERATIONAL_SETTING_INVALID` gains `params.rule` (`min` / `absolute` / `recommended`) and `params.limit`, so the
field error reads "Above the recommended 2000 - <reason>" in the operator's language instead of a generic
sentence (the gap #3867 left).

### 2.4 Connection test `message` -> `outcome`

`ConnectionTestResult` gains optional `outcome: ConnectionTestOutcome`
(`ok` / `unauthorized` / `unreachable` / `timeout` / `not-found` / `misconfigured` / `unexpected-status` /
`unsupported`). Optional, so an out-of-tree tester still compiles.

- Pure `resolveConnectionTestOutcome(result)` in `libs/core/src/integrations/domain/types/`: the adapter's own
  `outcome` when set, else derived (`success` -> `ok`; 401/403 -> `unauthorized`; 404 -> `not-found`; other
  status -> `unexpected-status`; no status -> `unreachable`). The test endpoint always returns `outcome`.
- The 12 in-tree testers set `outcome` where they know better than the status: missing config or credentials
  -> `misconfigured`, a timeout -> `timeout`, KSeF unsupported auth type -> `unsupported`.
- FE: title/body from `connections.testOutcome.<outcome>` (EN + PL); the adapter's `message` stays under the
  technical-details label on failure. Success keeps showing only the title, as after #3867 review - see open
  question 2.

## 3. Steps (one commit each)

1. Webhooks: union + reader + routing code + column + migration + DTO + FE copy + tests.
2. Sales-document block params: type + gate writers + writer/repository + migration + view/DTO + FE composer + tests.
3. Operational settings: FE copy per key, error params, FE field error + tests.
4. Connection test outcome: type + resolver + tester outcomes + controller + FE + tests.
5. Docs: `frontend-architecture.md` § Server text (the five fields now coded), plan.

Migrations follow `docs/migrations.md`: synthetic timestamps above `origin/main`'s newest, class suffix matching,
`migration:show` checked.

## 4. Tests

- Unit: `readWebhookDlqCode`, `resolveConnectionTestOutcome`, gate writers' params (each reason), repository
  coercion of `salesDocumentBlockParams`, operational-settings error params, FE composers (every reason/outcome,
  plus the raw fallback).
- Integration: webhook unroutable delivery persists `dlqCode`; the dlqCode backfill on a seeded row; an order
  blocked by the gate exposes `salesDocumentBlockParams` on `GET /orders/:id`.

## 5. Risks / open questions

1. **Operational-settings copy in two places - decided: option A.** The English reasons stay in the API response
   and in the backend's developer messages and logs; the FE renders its own EN + PL copy per key and no longer reads
   them. Dropping them from the API (option B) was rejected as a contract change with no operator-visible gain.
2. **Successful connection test detail - deferred.** Since #3867 review a successful test shows only its title.
   PrestaShop's success message carries the shop's sales country and eParagony's the granted scopes; showing them
   translated (`params.salesCountry` / `params.scopes`) is a follow-up, not part of this change.
3. **No backfill for block params.** Existing blocked orders keep the raw detail until their next transition
   re-decides the gate (level-triggered), so the English fades out on its own.
