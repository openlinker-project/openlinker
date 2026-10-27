# Implementation plan - upload the issued invoice/receipt to the marketplace order (#3549)

Part of #3510 (G06). Decision D30. Mockup M24 (`ksef-issued`, `receipt-issued`, `viewer`).
Depends on #3548 (`IInvoiceAttachmentService`) and #3620 (KSeF PDF). Stacked branch.
Status: DRAFT, local only (not committed).

## 1. Goal and layer

Once a sales document is issued and attachable, push it to the originating marketplace order so the buyer sees it there: Allegro and Erli. Best-effort, never blocks issuance, retryable, operator-visible.

Layers: **CORE** (capability, upload service, status persistence, job), **Integration** (Allegro adapter; Erli - see 3.1), **Interface** (status read, retry route, timeline entries), **Frontend** (status chip, retry button).

### Non-goals
- Uploading to shops (PrestaShop, WooCommerce) - out of scope per the issue.
- The legal e-receipt PDF (stays at eparagony.pl, D30).
- Email (#3550).

## 2. What exists

- `IInvoiceAttachmentService.resolveAttachment` (#3548): `pdf` bytes, a `link`, `waiting`, or `none`. The upload source.
- `OrderStatusWriteback` relay (ADR-027): the pattern to mirror for "push a fact back to the originating order" - capability + `is*` guard + role-agnostic dispatch + per-target result.
- `AllegroHttpClient` has `postBinary` and `postMultipart` but **no PUT with a binary body**.
- Nothing in `libs/integrations/allegro` or `erli` touches order invoices.

## 3. Findings that change the scope (need a decision)

### 3.1 Erli has no documented endpoint for this
The Erli sandbox swagger in the repo (`docs/architecture/adrs/erli-sandbox-swagger.json`) exposes `PATCH /orders/{id}` whose body is `deliveryTracking` and `externalOrderId` only, and `PATCH /orders/{id}/status`. `/dictionaries/attachment*` are PRODUCT attachments, `/billing/*` is the seller's own billing with Erli. **There is no way to attach a billing document to an Erli order.** AC "ErliOrderSourceAdapter implements the equivalent for Erli" cannot be met from the contract we hold. Proposed: Erli declares nothing (no capability), the upload reports `unsupported` for it - the epic's own principle ("a platform that cannot show a state declines it as no-capability; never an error"). Needs confirmation that no newer Erli endpoint exists.

### 3.2 Allegro's flow (from Allegro's own 2021 announcement; must be re-verified)
Two calls: `POST /order/checkout-forms/{id}/invoices` (metadata `{file:{name}, invoiceNumber}` -> invoice id), then `PUT /order/checkout-forms/{id}/invoices/{invoiceId}/file` with `Content-Type: application/pdf`. One invoice per order; PDF only; size limit 2 MB (to be re-checked, and a KSeF PDF with embedded fonts is ~0.2 MB, but fonts are embedded per document). A second upload for the same order must be treated as already-done, not as a failure.

### 3.3 Sandbox verification cannot be done from here
The AC requires request/response recorded from the sandbox in the PR description. No sandbox credentials are available in this session. Without them the Allegro half ships unverified against the live API; this must be stated in the PR, not hidden.

### 3.4 A link is not a file
Allegro takes a PDF, not a URL. For providers that resolve to a `link` only (Subiekt `pdfUrl`, eparagony, a KSeF record not yet rendered), the upload reports `no-file` rather than uploading a link. Fetching a remote `pdfUrl` and re-uploading it was rejected: it is an outbound fetch of provider-controlled URLs from the worker (SSRF surface) for a convenience.

## 4. Design

### 4.1 Capability (core, orders)
`OrderBillingDocumentUploader` in `libs/core/src/orders/domain/ports/capabilities/order-billing-document-uploader.capability.ts`, guard `isOrderBillingDocumentUploader`. Method `uploadBillingDocument(input)` taking an allowlisted neutral input `{ externalOrderId, documentNumber, fileName, content, contentType }` and returning a closed result `uploaded | already-present | unsupported | rejected | transient-failure`, never throwing for a modelled condition (the `OrderWritebackResult` shape). Advertised-without-dispatch: resolved by narrowing the dispatched `OrderSource` adapter, absent from `CoreCapabilityValues`.

### 4.2 Upload service (core)
`IInvoiceMarketplaceUploadService.upload(invoiceId)`:
1. `resolveAttachment`: only `pdf` is uploadable; `waiting` -> deferred (no row written as failed); `link`/`none` -> `no-file`.
2. Find the order's source connection and external id through identifier mapping; resolve its adapter; narrow with the guard.
3. Claim the attempt, call, persist the outcome.

Never throws into issuance: the trigger is a separate job (4.3).

### 4.3 Trigger and retry
New job `invoicing.marketplaceUpload` (retryable, idempotency key `invoice-upload:{invoiceId}:{targetConnectionId}`), enqueued best-effort after a successful issue from BOTH the auto-issue path (`invoicing.issue` handler) and the manual path (`InvoiceService.issueInvoice`'s caller). Lane `bulk`-vs-`realtime` to be chosen by ADR-050's cost-of-starvation rule; proposed `bulk` (nobody waits on it). Boot lane-coverage assertion forces the registration. Waiting for a KSeF number: the job reschedules itself with a bounded budget rather than failing.

### 4.4 Persistence
`invoice_marketplace_uploads` (one row per `(invoiceRecordId, targetConnectionId)`): `status` (`pending | uploaded | failed | unsupported | no-file`), `attempts`, `lastError` (a stable code, never the provider message - provider bodies can carry order data), `uploadedAt`, timestamps. Unique on the pair = the at-most-once claim; no FK (cross-aggregate reference by value, the repo precedent). Migration with `up`/`down`.

### 4.5 Interface
- `GET /invoices/:id/marketplace-upload` (`admin`, `operator`, `viewer`): status for the chip.
- `POST /invoices/:id/marketplace-upload/retry` (`admin` only - `invoices:write`).
- Timeline: the order timeline gains `invoice-uploaded` and `invoice-upload-failed` entries from this table (a projection, not a second write path).

### 4.6 Frontend
Status chip on the document (M24) and a retry button gated on `invoices:write`. Copy through one table, never restating backend codes.

### 4.7 Allegro adapter
`AllegroOrderSourceAdapter.uploadBillingDocument` + `AllegroHttpClient.putBinary`. A 409/"already added" maps to `already-present`; a 4xx is `rejected` (terminal); 5xx/429/timeout is `transient-failure`.

## 5. Steps
1. Capability + types + guard + spec (core/orders).
2. Persistence: ORM entity, repository port + impl, migration, parity with the migration-vs-synchronize check.
3. `InvoiceMarketplaceUploadService` + interface + token + module wiring + spec (success, no-file, waiting, unsupported, rejected, transient).
4. Job type + payload + handler + lane registration + enqueue from both issue paths + spec.
5. `AllegroHttpClient.putBinary` + `AllegroOrderSourceAdapter.uploadBillingDocument` + spec (mocked HTTP).
6. API: status and retry routes, DTOs, role tests, timeline projection.
7. Frontend: status chip + retry + test.
8. Docs: `architecture-overview.md`, `docs/lessons.md` if a mistake surfaces.

## 6. Risks
- Erli cannot be implemented from the held contract (3.1).
- Allegro behaviour is unverified against a sandbox (3.3); the 2021 post may be stale.
- Large: capability + table + job + 2 routes + adapter + FE. Candidate split: backend (steps 1-6) and frontend (7) as two PRs, as the epic itself does for send-by-email.
- A migration + a job type + a lane registration: the three places a repo-wide boot/parity check will fail loudly if one is forgotten.
