# Implementation Plan: Invoicing Backend — close every seam the FE design needs

**Date**: 2026-06-25
**Status**: Draft — execution-ready for a backend-orchestrator agent
**Estimated Effort**: ~4–6 dev-days across 6 work items (4 edit unmerged PRs, 1 existing issue, 1 new issue)

> **Companion**: `docs/plans/implementation-plan-invoicing-fe-redesign.md` (the FE
> program). This plan **freezes the contracts** that the parallel FE orchestrator
> binds to — see §7 FROZEN CONTRACTS.

> **Process constraints (hard)**: this plan is doc-only (uncommitted, no plan PR,
> no worktree). It creates **no** GitHub issues except **one** (N2, batch
> endpoint) which has no home PR. Every other item **edits an unmerged PR in
> place** or implements an already-open issue. Resource-constrained machine:
> scope checks to touched packages (`pnpm --filter <pkg> lint|type-check|test`),
> commit signed `--no-verify -s -S`, never the full pre-commit hook.

---

## 1. Task Summary

**Objective**: Implement every backend seam the merged invoicing FE design
depends on, with **zero debt / zero trade-offs** — so the FE renders at full
fidelity rather than degrading. The work is small and surgical: most of it
**extends PRs already in flight**.

**Context**: The FE redesign (mockup + FE plan) surfaced a precise set of
backend dependencies (FE plan §9). GitHub state moved since: `#1229`+`#1230`
now share **#1238**; `#1214` already adds `issuing` + `failureMode` to the
domain; `#1231` already ships the UPO endpoint + a slim order-invoice
projection + a `RegulatoryDocumentReader` capability. This plan fills the
remaining gaps on top of that.

**Classification**: Interface (response DTOs + endpoints) + Infrastructure
(persistence/migrations) + Integration (KSeF/Subiekt adapters). Core stays
neutral (ADR-026).

---

## 2. Scope & Non-Goals

### In Scope (do everything)
1. **[EDIT #1214]** Expose `failureMode` (+ sanitized `failureCode`/`failureReason`) on the invoice response DTO. (`status:'issuing'` is **already** exposed.)
2. **[EDIT #1231]** Add `GET /invoices/:invoiceId` (full record) + persist & expose the **issued-document content** (seller/buyer/lines/VAT) for the detail "Invoice contents" card. (UPO endpoint + slim order projection **already** exist here.)
3. **[EDIT #1189]** Persist the issued **FA(3) XML** + serve a document fetch (XML + human-readable) via the existing `RegulatoryDocumentReader` seam.
4. **[EDIT #1238]** Subiekt correction supports **price *and* quantity** per line; confirm `getClearanceStatus` is wired into the #1121 reconcile; reconcile the Subiekt↔bridge **endpoint paths**.
5. **[IMPLEMENT #1202]** Denormalize buyer tax-id onto `invoice_records` + `?taxId=with|without` filter on `GET /invoices`.
6. **[NEW issue N2]** Batch retry endpoint (server retries only `rejected`; skips `issued`/`in-doubt`).

### Out of Scope
- All FE work (separate plan/orchestrator).
- KSeF/Subiekt feature scope beyond the above (the adapters' own issues stand).
- Receipts/fiscalization (paragony) — invoice-only per the FE plan.
- New ADRs (the neutral contract is governed by the existing ADR-026; no
  cross-context decision is introduced — see §3).

### Constraints
- Maximize edits to unmerged PRs; reuse open issues (auto-close via `Closes #N`).
- Neutral core (ADR-026): no `nip`/`ksef`/`vat`/`faktura` in `libs/core`
  invoicing types; provider specifics stay in adapters.
- Migrations follow `docs/migrations.md` (synthetic sequential prefix, strictly
  greater than current tail; #1214 already adds `1812000000000`).

---

## 3. Architecture Mapping

**Target layers**: Interface (`apps/api/src/invoicing/http`, `.../orders/http`),
Core domain/infra (`libs/core/src/invoicing`), Integrations
(`libs/integrations/{ksef,subiekt}`).

**Capabilities involved** (all already exist — extended, not invented):
- `InvoicingPort`, `RegulatoryStatusReader`, `RegulatoryTransmitter`.
- `RegulatoryDocumentReader` (added by #1231 for UPO) — **reused** for FA(3)
  document fetch (W3).

**Core vs Integration**: the DTO/endpoint/persistence work is core+interface and
stays neutral. FA(3)-XML persistence and Subiekt correction-price are
**adapter-internal** (KSeF/Subiekt packages) — they surface through the neutral
`RegulatoryDocumentReader` / `InvoicingPort` (+ correction) contracts. No new
core port is required; `RegulatoryDocumentReader` gains a neutral `documentKind`
discriminator rather than a KSeF-named method (keeps ADR-026 intact).

**No new ADR**: this is additive within ADR-026's existing neutral surface; the
one judgment call (persist issued-document content vs reconstruct from order) is
recorded in §8 Alternatives, not an ADR (single-context, no plugin-contract
change).

---

## 4. External / Domain Research (current-state, verified)

- **#1214** (`1200-invoicing-exactly-once`): `InvoiceStatusValues = ['pending','issuing','issued','failed']`; `InvoiceFailureModeValues = ['rejected','in-doubt']`; `failureMode` on entity + `InvoiceOutcomePatch`; migration `1812000000000-add-invoice-record-retry-guards.ts`. Response DTO `status!: InvoiceStatus` (so `issuing` is already serialized) **but no `failureMode` field**. `errorMessage` deliberately omitted (PII).
- **#1231** (`1224-ksef-upo-endpoint`): `@Controller('invoices')` with `GET /invoices/:invoiceId/upo`; `RegulatoryDocumentReader` capability; `OrderInvoiceProjectionDto = { invoiceId, regulatoryStatus, clearanceReference, upoReference }` (slim — **no document content**) on the order response; KSeF adapter implements `RegulatoryDocumentReader`. **No `GET /invoices/:invoiceId`** (only `/upo`).
- **#1189** (`1151-ksef-kor-corrections`): KSeF adapter builds FA(3) XML at issue and submits it; clearance mapper `200 → accepted` (no `cleared`). XML is built but **not persisted for later fetch**.
- **#1238** (`1229-1230-subiekt-corrections-clearance`): Subiekt correction + `getClearanceStatus` in progress.
- **Merged**: `InvoiceRecord` projection (no buyer/lines columns); HTTP API `POST /invoices`, `GET /orders/:orderId/invoice?connectionId=`, `GET /invoices` (filters).

---

## 5. Questions & Assumptions

### Assumptions (safe defaults)
- **Issued-document content** is persisted **at issue time** (snapshot), not
  reconstructed from the live order — an order can change after the invoice is
  issued, and the document must reflect what was issued. Stored neutrally as a
  jsonb column on `invoice_records` (or a 1:1 child table). [§8 Alt-1]
- `GET /invoices/:invoiceId` returns the **same** `InvoiceRecordResponseDto` as
  the list/get-per-order; the rich content is a **separate** content endpoint
  (so the list DTO stays slim and the content seam is independently cacheable).
- `failureCode` is a **closed neutral enum** (PII-free); `failureReason` is an
  optional short localizable-key-or-sanitized string. Adapters map their native
  error to a `failureCode`; unknown → `provider-error`.
- N2 batch retry reuses the single-invoice retry primitive per id (no parallel
  bulk pipeline) — mirrors the bulk-offer precedent (architecture-overview
  §Listings bulk-flow).

### Open questions (non-blocking; defaulted)
- Q1: content endpoint path — default `GET /invoices/:invoiceId/content`
  (neutral) vs folding content into the detail DTO. **Default: separate
  endpoint** (keeps detail DTO == list DTO).
- Q2: FA(3) document fetch shape — default extend `RegulatoryDocumentReader`
  with `documentKind: 'upo' | 'source' | 'rendered'` so UPO + FA(3)-XML +
  FA(3)-HTML share one neutral method (§7).

---

## 6. Proposed Implementation Plan (per work item)

> Each item names the **branch to edit** (or NEW). Steps are small + testable.
> Sequencing in §9.

### W1 — Expose `failureMode` (+ `failureCode`/`failureReason`) on the response DTO — **EDIT PR #1214** (`1200-invoicing-exactly-once`)
**Goal**: FE can distinguish `rejected` (safe to retry) from `in-doubt` (no blind
retry) — the fiscal-safety unblocker. `issuing` is already exposed.

**Steps**:
1. **Core types** — `libs/core/src/invoicing/domain/types/invoicing.types.ts`:
   add `InvoiceFailureCodeValues` (`as const`, e.g. `['buyer-tax-id-invalid','provider-rejected','transport-timeout','provider-error']`) + `InvoiceFailureCode` type; add `failureCode?: InvoiceFailureCode | null` + `failureReason?: string | null` to `InvoiceRecord` + `CreateInvoiceRecordInput` + `InvoiceOutcomePatch`. (Reuse the existing `failureMode` already added here.)
2. **ORM + migration** — `.../infrastructure/persistence/entities/invoice-record.orm-entity.ts` + **extend the existing `1812000000000` migration** (same PR, not yet merged) to add `failure_code` + `failure_reason` nullable columns (alongside `failure_mode`).
3. **Repository mapping** — `.../repositories/invoice-record.repository.ts`: map the two new columns in `toDomain`/`toOrm`.
4. **Response DTO** — `apps/api/src/invoicing/http/dto/invoice-record-response.dto.ts`: add `failureMode!: InvoiceFailureMode | null`, `failureCode!: InvoiceFailureCode | null`, `failureReason!: string | null` (`@ApiProperty` each). **Still omit `errorMessage`** (PII).
5. **Controller** — `invoicing.controller.ts toDto`: map the three fields.
6. **Service** — where a failure is recorded (`InvoiceService` issue/retry path), set `failureMode` (already) + derive `failureCode` from the adapter's neutral error (`failureMode==='rejected'`→ provider's rejection code; `in-doubt`→ `transport-timeout`/`provider-error`).
**Acceptance**: `GET /invoices`/`/orders/:id/invoice` responses carry
`status:'issuing'` + `failureMode` + `failureCode` + `failureReason`; unit +
controller spec updated; `pnpm --filter @openlinker/api --filter @openlinker/core test` green.

### W2 — `GET /invoices/:invoiceId` + issued-document **content** — **EDIT PR #1231** (`1224-ksef-upo-endpoint`)
**Goal**: back the detail page (full record) and its "Invoice contents" card.

**Steps**:
1. **Repository** — `InvoiceRecordRepositoryPort` + impl: add `findById(invoiceId): Promise<InvoiceRecord | null>` (port already gains methods in this PR).
2. **Service + controller** — `InvoiceService.getInvoiceById` + `@Get(':invoiceId')` on the existing `@Controller('invoices')`, returning `InvoiceRecordResponseDto`; `404` when absent. (Sits beside the existing `/:invoiceId/upo`.)
3. **Issued-document content (snapshot at issue)**:
   - Core: new neutral type `IssuedDocumentContent` (`libs/core/src/invoicing/domain/types/invoicing.types.ts`) — see §7. Persist it: jsonb column `document_content` on `invoice_records` (new migration, prefix > `1812000000000`).
   - `InvoiceService.issueInvoice`: when the adapter returns success, snapshot content from the `IssueInvoiceCommand` (buyer, lines, currency) + seller (resolved by the adapter / connection config, returned on the result) + computed VAT breakdown, and persist via `updateOutcome`/a dedicated repo method.
   - **Adapter surface**: extend the `InvoicingPort.issueInvoice` result (or `InvoiceRecord`) to carry the seller block the adapter resolved (KSeF: from `KsefSellerConfig`; Subiekt: from the bridge document) — neutral shape, no provider names.
   - Interface: `GET /invoices/:invoiceId/content` → `IssuedDocumentContentDto` (§7); `404`/`409` when no content yet.
4. **Order projection** (optional reuse): the slim `OrderInvoiceProjectionDto` stays as-is for the order response; the rich content lives behind the content endpoint.
**Acceptance**: detail endpoint returns the record; content endpoint returns
seller/buyer/lines/VAT for an issued invoice; int-spec covers both; existing
UPO int-spec stays green.

### W3 — Persist FA(3) XML + document fetch — **EDIT PR #1189** (`1151-ksef-kor-corrections`)
**Goal**: back the KSeF FA(3) visualization (HTML) + XML download.

**Steps**:
1. **KSeF adapter** — persist the built FA(3) XML at issue (adapter-private store keyed by the provider invoice id, or returned for core to persist as an opaque document blob — prefer core-persisted opaque blob to avoid adapter-side storage).
2. **`RegulatoryDocumentReader`** — extend the neutral capability with a `documentKind` param: `getRegulatoryDocument(record, kind: 'upo' | 'source' | 'rendered')` returning `{ contentType, bytes }` (or a URL). KSeF maps `source`→FA(3) XML, `rendered`→HTML, `upo`→UPO (existing). Keep the method neutral (no `fa3`/`ksef` in core).
3. **Interface** — `GET /invoices/:invoiceId/document?kind=source|rendered` beside `/upo` (or generalize `/upo` → `/document?kind=upo`, keeping `/upo` as an alias for back-compat with #1231).
**Acceptance**: for a cleared KSeF invoice, XML + HTML fetch return bytes;
`accepted` (never `cleared`) verified in the adapter mapper; KSeF package tests green.

### W4 — Subiekt correction price + clearance wiring + bridge paths — **EDIT PR #1238** (`1229-1230-subiekt-corrections-clearance`)
**Goal**: Subiekt correction parity (price *and* qty) + Subiekt invoices get
KSeF status/number + working E2E.

**Steps**:
1. **Correction** — ensure the Subiekt correction command/adapter carries **corrected price per line**, not only quantity (bridge KOR endpoint, bridge-repo #6, must accept it; coordinate the wire shape `{lp, newQty, newUnitNet}`).
2. **`getClearanceStatus`** — confirm `SubiektInvoicingAdapter implements RegulatoryStatusReader` and that the #1206/#1121 reconcile job picks Subiekt up (guard `isRegulatoryStatusReader`); Subiekt invoices then get `regulatoryStatus` + `clearanceReference` (KSeF number) refreshed.
3. **Bridge path reconciliation** — verify the live bridge routes; align the OL Subiekt adapter (`SubiektBridgeHttpClient`) and the bridge so they agree (`/api/invoices` vs `/api/faktury`, etc.). Pick the authoritative set, fix the other side. (May be a bridge-repo change + an OL adapter change.)
**Acceptance**: Subiekt correction issues with adjusted price+qty; a Subiekt
invoice shows non-`not-applicable` `regulatoryStatus` after reconcile; Subiekt
adapter int-spec (HTTP-seam fake) exercises the real paths.

### W5 — Tax-id list filter — **IMPLEMENT open issue #1202**
**Steps**:
1. **Migration** — denormalize buyer tax-id presence onto `invoice_records`
   (`buyer_tax_id_scheme` / `buyer_tax_id_value` nullable, or a boolean
   `has_buyer_tax_id`). New migration, prefix > W2's.
2. **Write path** — `InvoiceService.issueInvoice` populates it from the command's buyer.
3. **Query** — `InvoiceRecordRepositoryPort.findMany` + repo: accept a `taxId: 'with' | 'without'` filter; `GET /invoices` query DTO gains `?taxId=`.
**Acceptance**: `GET /invoices?taxId=with|without` filters correctly; query DTO
validated; list int-spec covers both.

### W6 — Batch retry endpoint — **NEW issue N2** (`/create-issue`)
**Steps**:
1. **Issue** — `[IMPL] feat(invoicing): batch issue/retry endpoint` (small, self-contained).
2. **Endpoint** — `POST /invoices/retry` (body: `{ invoiceIds: string[] }` or `{ orderIds, connectionId }`); for each, reuse the single-invoice retry primitive; **server-side skip** any record not in a retry-eligible state (`failed` + `failureMode==='rejected'`); skip `issued`/`issuing`/`in-doubt`. Returns a per-id outcome summary `{ retried, skipped, results: [{id, outcome}] }`.
**Acceptance**: bulk retry re-attempts only eligible rows, reports skipped;
controller spec covers the skip rules.

### Implementation details (cross-cutting)
- **Migrations**: 3 new (W1 extends existing #1214 migration; W2 content column; W5 tax-id column) — each prefix strictly greater than the current tail, synthetic sequential per `docs/migrations.md`.
- **Error handling**: adapters map native errors to neutral `failureMode` (already) + `failureCode`; repositories convert infra errors to domain errors (existing pattern).
- **Idempotency**: unchanged — single-invoice issue/retry idempotency (#1200) is reused by N2; content snapshot is write-once at issue.
- **Events**: none new.

---

## 7. FROZEN CONTRACTS (the FE orchestrator binds to these)

### 7.1 `InvoiceRecordResponseDto` (additions — W1)
```
status: 'pending' | 'issuing' | 'issued' | 'failed'        // 'issuing' already shipped (#1214)
failureMode: 'rejected' | 'in-doubt' | null                // NEW (W1)
failureCode: 'buyer-tax-id-invalid' | 'provider-rejected'
           | 'transport-timeout' | 'provider-error' | null // NEW (W1) — closed neutral enum, PII-free
failureReason: string | null                               // NEW (W1) — short sanitized/localizable, no PII
// unchanged: id, connectionId, orderId, providerType, documentType,
// providerInvoiceId, providerInvoiceNumber, regulatoryStatus, clearanceReference,
// pdfUrl, issuedAt, createdAt, updatedAt.  errorMessage stays OMITTED.
```
FE rule: Retry is allowed **iff** `status==='failed' && failureMode==='rejected'`.
`regulatoryStatus` success terminal = **`accepted`** (KSeF emits `accepted`, not `cleared`).

### 7.2 Endpoints
| Method | Path | Request | Response | Item |
|---|---|---|---|---|
| GET | `/invoices/:invoiceId` | — | `InvoiceRecordResponseDto` (404 if absent) | W2 |
| GET | `/invoices/:invoiceId/content` | — | `IssuedDocumentContentDto` (404/409 if no content) | W2 |
| GET | `/invoices/:invoiceId/upo` | — | document bytes (Content-Type per provider) | exists (#1231) |
| GET | `/invoices/:invoiceId/document?kind=source\|rendered` | — | document bytes (XML / HTML) | W3 |
| GET | `/invoices?…&taxId=with\|without` | query | `PaginatedInvoicesResponseDto` | W5 |
| POST | `/invoices/retry` | `{ invoiceIds: string[] }` | `{ retried: number, skipped: number, results: {id, outcome}[] }` | W6 |

### 7.3 `IssuedDocumentContentDto` (neutral — W2)
```
seller:   { name: string; taxId: { scheme: string; value: string }; address: BuyerAddress }
buyer:    { name: string; taxId: { scheme: string; value: string } | null; address: BuyerAddress }
lines:    { name: string; quantity: number; unitNet: number; taxRate: string;
            net: number; vat: number; gross: number }[]
vatBreakdown: { rate: string; net: number; vat: number; gross: number }[]
totals:   { net: number; vat: number; gross: number }
currency: string            // ISO 4217
issueDate: string | null    // ISO
saleDate:  string | null    // ISO
payment:   { method: string | null; paidAt: string | null } | null
```
(`BuyerAddress` = the existing neutral `{ line1, line2|null, city, postalCode, countryIso2 }`.)

### 7.4 Existing — FE just consumes (no backend change)
- `connection.status` (`active|disabled|error|needs_reauth`) → needs-reauth affordance.
- `connection.config.invoicing.triggerModel` (`manual|auto-on-paid|auto-on-shipped`) → wizard trigger (KSeF + Subiekt), read by #1120/#1206.
- `providerType` + `connectionId` on the DTO → the list Connection column.

---

## 8. Alternatives Considered
- **Alt-1 (content): reconstruct from the live order instead of snapshotting at issue.** Rejected — the order can change after issuance; the document must reflect what was issued. Snapshot is the only correct source. Trade-off: a jsonb column / child row; acceptable.
- **Alt-2 (FA(3) doc): adapter-side storage of the XML.** Rejected — prefer core-persisted opaque document blob via the neutral `RegulatoryDocumentReader` so the interface layer doesn't reach into a plugin and storage policy is uniform.
- **Alt-3 (failureCode): free-text only.** Rejected — a closed neutral enum lets the FE localize copy and keeps PII out; free-text reason stays optional/sanitized.
- **Alt-4 (batch): a parallel bulk pipeline.** Rejected — reuse the single-invoice retry primitive per id (bulk-offer precedent), no new orchestration.

## 9. Validation, Risks & Orchestration

### Architecture / standards
- ✅ Neutral core (ADR-026): new types carry no provider vocabulary; `failureCode` is a neutral enum; FA(3)/UPO ride the neutral `RegulatoryDocumentReader`.
- ✅ Hexagonal: DTOs in interface layer; persistence in infra; adapters map native→neutral.
- ✅ `as const` unions for `failureCode`; migrations per `docs/migrations.md`.

### Risks / edge cases
- **Migration ordering** — three new migrations (incl. extending #1214's). Each must be strictly-greater synthetic prefix; verify with `pnpm --filter @openlinker/api migration:show`.
- **Content backfill** — pre-existing invoices have no `document_content`; the content endpoint returns 409/empty for them (no backfill; FE shows "content unavailable" gracefully).
- **Bridge path mismatch (W4)** — touches a second repo; verify against the running bridge before asserting fixed.
- **Backward compat** — all DTO additions are additive/nullable; no breaking change.

### Orchestration order (for the backend agent)
1. **W1 (#1214)** — first; cross-cutting unblocker for FE fiscal-safety. Ships independently.
2. **W2 (#1231)** — detail endpoint + content; unblocks the detail page + Invoice-contents card.
3. **W3 (#1189), W4 (#1238), W5 (#1202), W6 (N2)** — parallel after W1/W2 (independent surfaces). W6 first needs the `/create-issue`.

### FE dependency map (what the FE orchestrator waits on)
- FE **in-doubt/issuing states + bulk eligibility** ⇐ **W1**.
- FE **invoice detail page + Invoice-contents card** ⇐ **W2**.
- FE **FA(3) visualization / XML download** ⇐ **W3**.
- FE **Subiekt clearance surfacing + correction price** ⇐ **W4**.
- FE **tax-id filter** ⇐ **W5**; FE **bulk retry** ⇐ **W6** (degrades to sequential without it).

---

## 10. Testing Strategy & Acceptance

- **Unit** (`*.spec.ts`): `InvoiceService` failure-code derivation + content snapshot; repository `findById`/content/tax-id mapping; controller `toDto` (new fields) + new endpoints; KSeF document mapper (`accepted`, doc kinds); Subiekt correction price mapping + `getClearanceStatus`.
- **Integration** (`*.int-spec.ts`): `GET /invoices/:id` + `/content` + `/document` happy/404/409; `GET /invoices?taxId=`; `POST /invoices/retry` skip rules; reuse the existing UPO int-spec.
- **Acceptance**:
  - [ ] Response DTO exposes `status:'issuing'`, `failureMode`, `failureCode`, `failureReason`; never `errorMessage`.
  - [ ] `GET /invoices/:invoiceId` + `/content` + `/document?kind=` return correct shapes (§7).
  - [ ] KSeF success = `accepted` end-to-end; FA(3) XML+HTML fetchable.
  - [ ] Subiekt correction carries price+qty; Subiekt invoice gets clearance via reconcile.
  - [ ] `?taxId=with|without` filters; `POST /invoices/retry` retries only `rejected`.
  - [ ] Migrations show clean; touched-package `lint`+`type-check`+`test` green.

## 11. Alignment Checklist
- [x] Hexagonal layers + neutral core (ADR-026)
- [x] Edits unmerged PRs in place; 1 new issue (N2) only
- [x] Idempotency reused (#1200); content snapshot write-once
- [x] Migrations per `docs/migrations.md` (strictly-greater synthetic prefixes)
- [x] Error handling neutral (failureMode/failureCode); no PII in DTO
- [x] Contracts frozen for the FE orchestrator (§7)
- [x] Testing strategy complete; execution-ready; doc-only (no PR/issues except N2)

## Related
- `docs/plans/implementation-plan-invoicing-fe-redesign.md` (FE companion, §9 seam list)
- `docs/architecture-overview.md` §Invoicing, ADR-026
- PRs: #1214, #1231, #1189, #1238, #1206 · issues: #1202, #1200, #1120, #1121, #1224, #1228, #1229, #1230
