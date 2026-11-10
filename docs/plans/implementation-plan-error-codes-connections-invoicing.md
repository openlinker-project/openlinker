# Implementation Plan: error codes for connections and invoicing (#3864)

## 1. Task understanding

**Goal.** Every error `connection.service.ts` and the invoicing controller send carries a stable `code` and the
`params` the frontend needs, so the frontend can pick translated copy by code (ADR-081: the backend never sends
translated text). No sentence-only error is left in the two files.

**Layer.** Interface / application (`apps/api`), plus the shared code vocabulary (`libs/shared/src/errors`).

**Base.** `3861-validation-field-errors` (PR #3922), which stands on `3860-api-error-envelope` (PR #3921):
`CodedHttpException`, the catch-all filter and `VALIDATION_FAILED` + `fields` come from there. #3861 also edits
`connection.service.ts`, so building on it avoids a conflict. The PR targets that branch and is retargeted to
`main` once #3921 and #3922 merge. The issue lists #3863 as a dependency; #3863 registers the codes some
endpoints already send - this PR registers the ones in its own two files and leaves the rest to #3863.

**Non-goals.** The frontend resolver and copy (#3862); the 7 global filters (#3863); other controllers (#3865);
translating anything on the backend.

## 2. Findings

- `connection.service.ts`: 54 throw sites. Mostly config validation (`config.rateLimit`, `pricingRule`,
  `priceSyncMode`, `autoDispatch`, `buyerEmails`, `deliveryOnDocuments` ...), credentials input, adapter
  support, archive / restore state, not found. Two existing codes travel in `error`:
  `ROUTING_REQUIRES_ACTIVE_LOCATION`, `STOCK_LOCATION_OVERRIDE_INVALID`. Credentials shape errors already carry
  `VALIDATION_FAILED` (#3861).
- `invoicing.controller.ts`: 44 throw sites plus `toHttpException`. Existing codes: `ORDER_CANCELLED`,
  `ORDER_FULLY_REFUNDED`, `CORRECTION_IN_PROGRESS`, `CORRECTION_NEEDS_RECONCILIATION`. **Provider text is already
  withheld on purpose** (PII: buyer data can echo back) - rejections send a closed `failureCode` and a fixed
  `failureReason`, other failures a correlation id. That posture stays: no provider text is added to any
  invoicing response.
- The only provider pass-through in scope is the credentials rewriter (`ConnectionCredentialsRewriteException`,
  e.g. Erli fetching Allegro credentials). Its message is plugin-authored and carries no buyer data; it becomes
  `PROVIDER_REJECTED` with `params.provider` and the text in a separate `providerMessage`.
- Existing frontend code reads extra body fields (`error: 'MissingNumberingSeriesException'`,
  `issuingConnectionId`, `retryable`, `failureCode`, `warningCode` ...). Those fields stay - the change is
  additive.

## 3. Design

### Contract changes (small, additive)

- `ApiErrorEnvelope` gains `providerMessage?: string` - raw text from an external system, shown by the frontend
  behind a translated prefix, never translated.
- `CodedHttpException` gains an optional `extras` argument for the existing body fields above, so converting a
  site never drops a field a client reads. `code`, `message`, `params` and `statusCode` cannot be overridden by
  extras.
- `codedHttpError(status, code, message, params?, extras?)` returns Nest's own exception for the status
  (`BadRequestException` for 400 ...) carrying the coded body. Callers and 68 existing spec assertions tell
  these errors apart by class, so a converted site keeps its class and only its body gains a code.
- New codes are added to `ApiErrorCodeValues`, each with a one-line comment, grouped by area.

### Codes

Connections:

| Code | Status | params |
|---|---|---|
| `CONNECTION_NOT_FOUND` | 404 | `connectionId` |
| `CONNECTION_CONFIG_INVALID` | 400 | `field`, `rule` (`object` / `boolean` / `string` / `number-min` / `number-range` / `one-of` / `required-with` / `set-together` / `below-100` / `email`...), and the rule's bounds (`min`, `max`, `allowed`) |
| `CONNECTION_CONFIG_NOT_UNIQUE` | 400 | `field`, `value`, `otherConnectionId`, `otherConnectionName` |
| `CONNECTION_CAPABILITIES_CONFLICT` | 400 | `capabilities` |
| `CONNECTION_CAPABILITIES_UNSUPPORTED` | 400 | `adapterKey`, `capabilities` |
| `ROUTING_REQUIRES_ACTIVE_LOCATION` | 400 | - (was in `error`, kept there too) |
| `STOCK_LOCATION_OVERRIDE_INVALID` | 400 | `reason` (`empty` / `unknown-location` / `inactive-location`), `locationId` |
| `WEBHOOK_PROVISIONING_UNSUPPORTED` | 400 | `adapterKey` |
| `CONNECTION_TEST_UNSUPPORTED` | 400 | `adapterKey` |
| `CREDENTIALS_INPUT_AMBIGUOUS` | 400 | - (exactly one of `credentials` / `credentialsRef`) |
| `CREDENTIALS_REF_INVALID` | 400 | - |
| `CREDENTIALS_ROTATION_UNSUPPORTED` | 400 | `connectionId` |
| `CREDENTIALS_NOT_ACCEPTED` | 400 | `connectionId` (adapter takes no credentials) |
| `PROVIDER_REJECTED` | 400 | `provider` (adapter key); text in `providerMessage` |
| `CONNECTION_ADAPTER_KEY_IMMUTABLE` | 400 | `current` |
| `CONNECTION_ARCHIVE_NOT_BY_STATUS` | 400 | - |
| `CONNECTION_ARCHIVED` | 409 | `connectionId` |
| `CONNECTION_NOT_DISABLED` | 409 | `status` |
| `CONNECTION_NOT_ARCHIVABLE` | 409 | `adapterKey` |
| `CONNECTION_NOT_ARCHIVED` | 409 | `status` |

`config.deliveryOnDocuments` issues already come as a path/message list: they go out as `VALIDATION_FAILED` with
`fields`, through the helper #3861 added for config shape errors.

Invoicing:

| Code | Status | params |
|---|---|---|
| `INVOICE_NOT_FOUND` | 404 | `invoiceId` |
| `ORDER_NOT_FOUND` | 404 | `orderId` |
| `ORDER_HAS_NO_INVOICE` | 404 | `orderId` |
| `INVOICE_ALREADY_ISSUED` | 409 | `orderId` |
| `INVOICE_ISSUE_IN_PROGRESS` | 409 | `orderId` |
| `ORDER_CANCELLED`, `ORDER_FULLY_REFUNDED` | 409 | - (existing codes, registered) |
| `CORRECTION_IN_PROGRESS`, `CORRECTION_NEEDS_RECONCILIATION` | 409 | - (existing, registered) |
| `INVOICE_RECORD_DUPLICATE` | 409 | - |
| `ORDER_ALREADY_INVOICED` | 409 | ids stay as extras |
| `ORDER_ALREADY_HAS_FISCAL_RECEIPT` | 409 | ids stay as extras |
| `INVOICE_ISSUE_CONTENDED` | 409 | `retryable` stays |
| `MISSING_TAX_RATE` | 422 | `lineCount`, `totalLines` |
| `MISSING_NUMBERING_SERIES` | 400 | - |
| `INVOICE_DATA_INVALID` | 400 | `reason` (`buyer-profile` / `invoice-line` / `price-treatment` / `unknown-order-lines`), `lines` (messages come from OpenLinker's own mappers) |
| `ORDER_BUYER_DETAILS_UNAVAILABLE` | 422 | `orderId` |
| `INVOICE_ISSUE_REJECTED` | 422 | `failureCode`; `failureReason` / `warningCode` stay as extras |
| `INVOICE_ISSUE_FAILED` | 422 | `correlationId` |
| `INVOICE_NOT_FULLY_ISSUED` | 422 | `invoiceId`, `missing` (`provider-invoice-id` / `document-number`) |
| `INVOICE_NOT_REJECTED` | 409 | `invoiceId`, `regulatoryStatus` |
| `INVOICE_DOCUMENT_UNAVAILABLE` | 409 | `invoiceId`, `reason` (`no-snapshot` / `no-source` / `not-ready` / `no-downloads` / `kind-unsupported` / `not-cleared` / `too-large`), `kind`, `status`, `regulatoryStatus`, `bytes`, `limitBytes` |
| `DOCUMENT_KIND_UNKNOWN` | 400 | `kind`, `supported` |
| `PROVIDER_CAPABILITY_UNSUPPORTED` | 501 | `capability`, `connectionId` |
| `INVOICING_PROVIDER_UNAVAILABLE` | 502 | - |
| `INVOICING_PROVIDER_REQUEST_FAILED` | 502 | - |
| `MARKETPLACE_UPLOAD_NOT_QUEUED` | 503 | `invoiceId` |
| `NUMBERING_SERIES_NOT_FOUND` | 404 / 400 | `seriesId` where known |
| `NUMBERING_PATTERN_INVALID` | 400 | - (`errors` kept) |
| `NUMBERING_GAP_REASON_REQUIRED` | 400 | - |
| `DOCUMENT_NUMBER_TOO_LONG` | 400 | `actualLength`, `maxLength` |
| `DOCUMENT_NUMBER_DUPLICATE` | 409 | - |

`document-email-refusal.ts` already sends a closed code per refusal and is left to #3863. `ConnectionInUseException`
goes through its global filter (#3863).

The English `message` stays as it is today on every site (developer and log text). Params are values only,
never sentences. Request-body errors in the controller that are field checks (`accountId`) become
`VALIDATION_FAILED` with `fields`, like #3861's DTO errors.

## 4. Steps

1. `libs/shared/src/errors`: `providerMessage` on the envelope; the codes above in `ApiErrorCodeValues`.
2. `CodedHttpException`: optional `extras`, guarded so it cannot override the envelope fields; spec.
3. `connection.service.ts`: one small private helper per repeated shape (`configInvalid(field, rule, bounds)`),
   then every site converted; `deliveryOnDocuments` through the #3861 helper.
4. `invoicing.controller.ts` (+ `numbering-series.controller.ts` if its 2 sites are in the same family):
   every site converted, `toHttpException` keeping its PII posture.
5. Specs: update the ones that assert bodies; add specs for the config-invalid helper, the extras guard and
   `PROVIDER_REJECTED`. A scan test asserting no `new BadRequestException('` / `ConflictException(` /
   `NotFoundException(` with a string remains in the two files.
6. Quality gate: lint, type-check, unit tests of `apps/api` and `libs/shared`; `check:invariants`.

## 5. Risks

- A code is permanent once released; the list above is the review point.
- Clients that match `message` text keep working (messages unchanged); clients that read `error` keep working
  (kept as extra where it was set).
