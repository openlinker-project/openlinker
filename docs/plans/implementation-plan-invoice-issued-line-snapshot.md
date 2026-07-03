# Implementation Plan: Persist issuance-time line snapshot on InvoiceRecord for safe KSeF corrections (#1297)

**Date**: 2026-07-02
**Status**: Ready for Review
**Estimated Effort**: ~1 day (0.5d implementation, 0.5d tests + verification)

---

## 1. Task Summary

**Objective**: Persist the true issuance-time line snapshot (buyer, currency, lines) on `InvoiceRecord` when a document is issued, and have the correction flow read that snapshot instead of re-deriving the original document's lines from the order's *current* live state.

**Context**: Today `buildOriginalDocumentSnapshot` in `apps/api/src/invoicing/http/invoicing.controller.ts` rebuilds the corrected document's `buyer`/`currency`/`lines` from the order's *current* state (`rehydrateOrder` -> `toIssueInvoiceCommand`), because `InvoiceRecord` persists no issuance-time snapshot. If the order's items changed after the original document was issued (edited quantity/price, added/removed/reordered line), the `originalLineNumber`-indexed correction deltas in a KOR may no longer match what the KSeF authority actually holds for the referenced original document. This is a documented, accepted limitation on `OriginalDocumentSnapshot`'s doc comment. Correcting a changed order is unsafe until the true snapshot is persisted.

**Classification**: CORE (domain + application + infrastructure/persistence) + Interface (controller).

---

## 2. Scope & Non-Goals

### In Scope
- New neutral type `IssuedLineSnapshot` capturing `{ buyer, currency, lines[] }` as issued.
- New nullable `issuedLineSnapshot` jsonb column on `invoice_records` (+ migration).
- Populate the snapshot in the core `InvoiceService` on the successful `issueInvoice` path (from the `IssueInvoiceCommand`) - mirroring how `documentContent` is populated.
- Populate the snapshot on the successful `issueCorrection` path (the correction's own post-correction "after" lines, computed from `originalDocument.lines` + the per-line deltas) so a correction-of-correction can diff against the prior correction.
- `buildOriginalDocumentSnapshot` (controller) prefers the persisted snapshot when present, falling back to the current order-derived reconstruction only for pre-migration records (or when the snapshot is absent).
- Correction-of-correction resolves its "before" snapshot from the document being corrected (which may itself be a correction), not from the live order.
- Unit tests for all new logic + verification with `migration:show`.

### Out of Scope
- Backfilling snapshots for `InvoiceRecord` rows issued before this migration (they keep the order-derived fallback).
- Exposing the snapshot through any API response DTO (it carries buyer PII - see §6).
- Any change to adapter packages (KSeF / inFakt / Subiekt). The snapshot is built in core `InvoiceService`, not in adapters - confirmed below.
- Persisting authoritative provider line money (the existing non-authoritative recompute note on `buildContent` is untouched).

### Constraints
- ADR-026 country-agnostic invoicing: no `NIP`/`KSeF`/`FA`/`VAT` vocabulary in `libs/core`. The snapshot reuses the already-neutral `BuyerProfile` + `InvoiceLine` types.
- Migration must follow the synthetic-sequential-prefix convention (docs/migrations.md #1013): strictly greater than the current tail `1818000000002`.
- Backward compatible: nullable column; unconfigured/legacy rows carry `NULL` and fall back to the existing behaviour.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/invoicing/**`) + Interface (`apps/api/src/invoicing/http/invoicing.controller.ts`) + a migration in `apps/api/src/migrations/`.

**Capabilities Involved**: none new. `InvoicingPort` / `CorrectionIssuer` are unchanged - the snapshot is derived from the command inputs the core service already holds, never from the adapter result.

**Existing Services Reused**:
- `InvoiceService` (`libs/core/src/invoicing/application/services/invoice.service.ts`) - `issueWithAdapter` and `issueCorrection` already persist their outcome via `repo.updateOutcome(id, patch)`; the snapshot rides the same `InvoiceOutcomePatch`.
- `InvoiceRecordRepository` (`.../infrastructure/persistence/repositories/invoice-record.repository.ts`) - `buildOrmEntity` / `toDomain` / `updateOutcome`.
- `InvoicingController.buildOriginalDocumentSnapshot` - the single correction-snapshot assembly site.

**New Components Required**:
- `IssuedLineSnapshot` interface (in `invoicing.types.ts`).
- `issuedLineSnapshot` field on the `InvoiceRecord` domain entity + `InvoiceRecordOrmEntity` + `CreateInvoiceRecordInput` + `InvoiceOutcomePatch`.
- A pure helper to apply correction deltas onto the original lines (compute the correction's "after" lines).
- One migration file.

**Core vs Integration Justification**: This is CORE. `InvoiceRecord`, its projection, and the correction-command assembly are all owned by the core invoicing context; the snapshot is a persistence concern of that projection. Confirmed the write path is pure-core: `documentContent` (the direct precedent) is built in `InvoiceService.issueWithAdapter` at `invoice.service.ts:334` via `buildContent(cmd, issued, seller)` and persisted through `repo.updateOutcome` - **not** in any adapter. The adapters (`ksef`/`infakt`/`subiekt`) construct their own `InvoiceRecord` for their return value, but the persisted projection fields are stamped by the core service. So no integration package changes.

**Reference**: [Architecture Overview - Invoicing](../architecture-overview.md#14-invoicing), ADR-026.

---

## 4. External / Domain Research

### Relationship to open PRs (base-branch decision)

The issue prompt flagged PR **#1317** (`1311-ksef-platnosc-plan`, "emit FA(3) Platnosc from connection payment config") as a possible base for this work. **It is not, and this branch is cut from `main`.** Evidence:

- **Zero file overlap.** #1317 changes `libs/integrations/ksef/**`, the KSeF FE plugin, and docs. #1297 changes `libs/core/src/invoicing/**`, `apps/api/src/invoicing/http/invoicing.controller.ts`, and a migration. No shared file. #1317's own PR body states: *"No CORE changes - everything stays inside `libs/integrations/ksef` and its FE plugin section (ADR-026 compliant)."*
- **Zero functional dependency.** The snapshot is written in the core `InvoiceService` from the `IssueInvoiceCommand`, never in `ksef-invoicing.adapter.ts` (the file #1317 edits). #1297 does not read, or depend on, anything #1317 introduces (`Platnosc` payment config).
- **Cost of a wrong base.** Branching on #1317 would pull its unmerged KSeF+FE diff into a pure-core PR, coupling two unrelated features and complicating review/merge order.

If a reviewer knows of a real ordering constraint not visible in the diffs, the branch can be rebased onto #1317's head cheaply (the file sets are disjoint, so a rebase is conflict-free). Absent that, `main` is correct.

Other open invoicing-adjacent PRs (#1320 capability-panel copy, #1309/#1310 inFakt payment method/bank picker, #1307 inFakt docs) are likewise disjoint from these core files.

### Internal patterns followed
- **`documentContent` / `sourceDocument` precedent** (#1224): nullable jsonb column on `invoice_records`, populated in the issued `InvoiceOutcomePatch`, mapped in `buildOrmEntity`/`toDomain`, migration `1818000000001` / `1818000000002`. This plan mirrors that precedent exactly.
- **`OriginalDocumentSnapshot` consumer**: `IssueCorrectionCommand.originalDocument` is caller-assembled by the controller and consumed by adapters that must resubmit a complete document (KSeF FA(3) KOR). Its shape is `{ buyer: BuyerProfile; currency; documentType; lines: InvoiceLine[]; clearanceReference; documentNumber; issueDate }` - the `documentType`/`clearanceReference`/`documentNumber`/`issueDate` come from the `InvoiceRecord` itself; only `buyer`/`currency`/`lines` need the snapshot.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. One reviewer check-point: confirm the base-branch decision in §4 (main, not #1317).

### Assumptions
- The snapshot lives on `InvoiceRecord` itself (jsonb column), matching the `documentContent`/`sourceDocument` precedent, rather than a separate table.
- Correction-of-correction resolves via the record already loaded by the controller (`getInvoiceById(invoiceId)` at `invoicing.controller.ts:350`), which *is* the document being corrected. No new `parentRecordId` linkage column is needed: reading `original.issuedLineSnapshot` already resolves "from the document being corrected", whether that document is an original invoice or a prior correction - **provided corrections also persist their snapshot** (they will, per Phase 3).
- A correction record's snapshot stores the **post-correction ("after") lines** - the corrected document's own line state - so the next correction diffs against them. Computed from `cmd.originalDocument.lines` + the `CorrectionLine[]` deltas; when `cmd.originalDocument` is absent (order no longer resolvable), the correction persists `null` and the *next* correction falls back to order-derived reconstruction (graceful degradation).
- jsonb round-trip loses the `BuyerProfile` class prototype (the `isCompany` getter). The snapshot's `buyer` is consumed structurally by `OriginalDocumentSnapshot` (fields only), so this is acceptable; the controller re-wraps into a `BuyerProfile` only if a consumer needs the getter (it does not today). Documented in the type's doc comment + covered by a test.

### Documentation Gaps
- The architecture-overview Invoicing section should gain a one-line note that `InvoiceRecord` persists an issuance-time line snapshot for safe corrections. Included in Phase 5.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain type + entity

**Goal**: Introduce the neutral snapshot shape and carry it on the domain entity.

**Steps**:
1. **Add `IssuedLineSnapshot` type**
   - **File**: `libs/core/src/invoicing/domain/types/invoicing.types.ts`
   - **Action**: Add
     ```ts
     /**
      * Issuance-time snapshot of the exact command inputs a correction needs to
      * reconstruct the original document (#1297). Neutral (ADR-026): reuses
      * `BuyerProfile` + `InvoiceLine`. Persisted as jsonb, so `buyer` round-trips
      * as a plain object (no `BuyerProfile` prototype / `isCompany` getter) -
      * consumed structurally by `OriginalDocumentSnapshot`. `documentType` /
      * clearance / number / issue date are NOT stored here; they are read from
      * the `InvoiceRecord` itself when assembling `OriginalDocumentSnapshot`.
      */
     export interface IssuedLineSnapshot {
       buyer: BuyerProfile;
       /** ISO 4217 currency code, echoed from the issue command. */
       currency: string;
       /** Lines exactly as issued (name/quantity/unitPriceGross/taxRate). */
       lines: InvoiceLine[];
     }
     ```
   - **Acceptance**: type-check passes; exported from the barrel (`invoicing/index.ts` already does `export * from './domain/types/invoicing.types'`).

2. **Add `issuedLineSnapshot` to the `InvoiceRecord` entity**
   - **File**: `libs/core/src/invoicing/domain/entities/invoice-record.entity.ts`
   - **Action**: Add a new **last** readonly constructor param `public readonly issuedLineSnapshot: IssuedLineSnapshot | null = null,` (after `sourceDocument`, keeping the default-null tail so all existing positional constructions stay valid). Import the type.
   - **Acceptance**: existing `new InvoiceRecord(...)` calls (repo `toDomain`, adapters) still compile (new param is defaulted).

### Phase 2: Persistence (ORM + repository + migration)

**Goal**: Store and retrieve the column.

**Steps**:
3. **ORM column**
   - **File**: `libs/core/src/invoicing/infrastructure/persistence/entities/invoice-record.orm-entity.ts`
   - **Action**: Add `@Column({ type: 'jsonb', nullable: true }) issuedLineSnapshot!: IssuedLineSnapshot | null;` beside `documentContent`/`sourceDocument`.

4. **Repository mapping**
   - **File**: `.../persistence/repositories/invoice-record.repository.ts`
   - **Action**:
     - `buildOrmEntity`: `entity.issuedLineSnapshot = input.issuedLineSnapshot ?? null;`
     - `toDomain`: pass `entity.issuedLineSnapshot` as the new last constructor arg.
     - `updateOutcome`: no change needed for the normal path (`Object.assign(entity, patch)` already applies any patch key). Verify the write-once `sourceDocument` guarded-UPDATE branch (`.set(patch)`) still carries `issuedLineSnapshot` when both are set together on the issued patch - it does, since `.set(patch)` includes every present key. Add a short comment noting the snapshot is not write-once (unlike `sourceDocument`).
   - **Acceptance**: unit/integration round-trip persists and reads the snapshot.

5. **Patch + create input types**
   - **File**: `libs/core/src/invoicing/domain/types/invoicing.types.ts`
   - **Action**: Add `issuedLineSnapshot?: IssuedLineSnapshot | null;` to both `CreateInvoiceRecordInput` and `InvoiceOutcomePatch` (documented as set once on the successful issued/correction patch).

6. **Migration**
   - **File**: `apps/api/src/migrations/1818000000003-add-invoice-issued-line-snapshot.ts`
   - **Action**: copy the `1818000000002-add-invoice-source-document.ts` shape. Class `AddInvoiceIssuedLineSnapshot1818000000003`. `up`: `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "issuedLineSnapshot" jsonb`. `down`: `DROP COLUMN IF EXISTS "issuedLineSnapshot"`. Header notes the synthetic prefix is strictly greater than `1818000000002`.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it as pending, then applied; `pnpm lint` timestamp invariant passes.

### Phase 3: Application service (write path)

**Goal**: Capture the snapshot at issue time and correction time.

**Steps**:
7. **`issueInvoice` snapshot**
   - **File**: `libs/core/src/invoicing/application/services/invoice.service.ts` (`issueWithAdapter`, ~line 334-367)
   - **Action**: right where `documentContent` is built, add
     `const issuedLineSnapshot: IssuedLineSnapshot = { buyer: cmd.buyer, currency: cmd.currency, lines: cmd.lines };`
     and include `issuedLineSnapshot` in the issued `InvoiceOutcomePatch`.
   - **Acceptance**: after a successful issue, the persisted record carries the command's buyer/currency/lines verbatim.

8. **`issueCorrection` snapshot (AC-4)**
   - **File**: same service, `issueCorrection` (~line 498 final `updateOutcome`)
   - **Action**: when `cmd.originalDocument` is present, compute the correction's post-correction lines and persist a snapshot:
     ```ts
     const afterLines = applyCorrectionDeltas(cmd.originalDocument.lines, cmd.lines);
     const issuedLineSnapshot: IssuedLineSnapshot = {
       buyer: cmd.originalDocument.buyer,
       currency: cmd.originalDocument.currency,
       lines: afterLines,
     };
     ```
     include it in the issued patch. When `cmd.originalDocument` is absent, omit it (persist `null`).
   - **Helper `applyCorrectionDeltas`**: a pure function (private method on the service, or a small `domain/` pure helper if reused) mapping each original line by 1-based position, applying `newQuantity`/`newUnitPriceGross` from any matching `CorrectionLine`, leaving unmatched lines unchanged. No I/O, no mutation of inputs.
   - **Acceptance**: correcting an original persists an "after"-lines snapshot; a second correction of that correction reads it (Phase 4).

### Phase 4: Interface (read path in the controller)

**Goal**: Prefer the persisted snapshot; fall back to order-derived only when absent.

**Steps**:
9. **`buildOriginalDocumentSnapshot` prefers the persisted snapshot**
   - **File**: `apps/api/src/invoicing/http/invoicing.controller.ts` (`issueCorrection` endpoint ~350-408 + `buildOriginalDocumentSnapshot` ~533-559)
   - **Action**: Restructure so that when `original.issuedLineSnapshot` is present, `OriginalDocumentSnapshot` is assembled directly from it - `buyer`/`currency`/`lines` from the snapshot, `documentType`/`clearanceReference`/`documentNumber`/`issueDate` from `original` - **with no order fetch**. Only when the snapshot is `null` (pre-migration / order-derived) does it fall back to `this.orders.getOrderRecord(...)` + the existing reconstruction.
     - Concretely: add a branch in the endpoint (or a `buildFromSnapshot(original)` sibling helper) before the `getOrderRecord` call; keep the existing `buildOriginalDocumentSnapshot(orderRecord, ...)` as the fallback.
     - `buyer` from jsonb is a plain object; wrap into `new BuyerProfile(b.name, b.taxId, b.address, b.type)` so the returned `OriginalDocumentSnapshot.buyer` is a real `BuyerProfile` (matches the fallback path's output and keeps the getter available). Note this in a comment.
   - **Acceptance**: with a persisted snapshot, the correction path does not call `getOrderRecord`; correcting an order whose lines changed since issuance produces deltas indexed against the *issued* lines, not the live order. Correction-of-correction reads the prior correction's snapshot (since `original` is the prior correction and it carries its own snapshot).
   - **Update the doc comments** on `OriginalDocumentSnapshot` (`invoicing.types.ts`) and the controller helper: the "lines read off the order's CURRENT state" accepted-limitation note now applies only to the pre-migration fallback; the primary path reads the persisted issuance-time snapshot. Remove the "UNSAFE until #1297" wording and point to the snapshot.

### Phase 5: Docs

10. **Architecture note**
    - **File**: `docs/architecture-overview.md` (§14 Invoicing) - one line that `InvoiceRecord` persists a neutral issuance-time line snapshot (`issuedLineSnapshot`) so corrections diff against issued lines, not the order's current state.

### Configuration / Events / Errors
- **Config**: none.
- **Events**: none.
- **Error handling**: none new. The snapshot is best-effort at the correction *read* side (absent -> fallback); at the write side it is always available for `issueInvoice` (from `cmd`) and best-effort for `issueCorrection` (present iff `cmd.originalDocument` present).

---

## 7. Alternatives Considered

### Alternative 1: Reuse the existing `documentContent` column instead of a new column
- **Description**: Derive `OriginalDocumentSnapshot` from the already-persisted `IssuedDocumentContent` (`documentContent`), which also carries `buyer`, `currency`, and `lines`.
- **Why rejected**: shape mismatch is lossy. `IssuedDocumentContent.lines` store `unitNet` (computed net unit price) + `net`/`tax`/`gross`, not `unitPriceGross`; reconstructing gross from net + a tax-rate fraction re-introduces rounding error on every correction, and `buildContent` itself flags its figures as a non-authoritative recompute. Its `buyer` is the reduced `IssuedDocumentBuyer` (no B2B/B2C `type`), whereas `OriginalDocumentSnapshot.buyer` needs a full `BuyerProfile`. A purpose-built `issuedLineSnapshot` storing the exact `IssueInvoiceCommand` inputs is exact and queryable, at the cost of one nullable column (same cost the `documentContent`/`sourceDocument` precedents already paid).

### Alternative 2: Add an explicit `parentRecordId` linkage column for correction chains
- **Description**: Persist a FK from a correction record to the record it corrects, and walk it for correction-of-correction.
- **Why rejected**: unnecessary. The controller already loads the document being corrected directly by path id (`getInvoiceById(invoiceId)`). Reading that record's own `issuedLineSnapshot` resolves the chain implicitly, whether it is an original or a prior correction. No new column, no walk.

---

## 8. Validation & Risks

### Architecture Compliance
- Domain entity gains only a readonly field (anemic-by-default preserved). Types in `*.types.ts`. Repository owns ORM<->domain mapping. Application service holds orchestration. Controller stays interface-only. All consistent with hexagonal + ADR-026.

### Naming Conventions
- `IssuedLineSnapshot` (PascalCase interface, in `*.types.ts`); `issuedLineSnapshot` field (camelCase); migration `AddInvoiceIssuedLineSnapshot1818000000003` (class suffix == filename prefix).

### Existing Patterns
- Mirrors `documentContent`/`sourceDocument` end-to-end (entity, ORM, patch, create-input, repo mapping, migration).

### Risks
- **jsonb prototype loss**: `buyer` read back is a plain object, not `BuyerProfile`. Mitigation: controller re-wraps into `new BuyerProfile(...)`; covered by a test. Consumers use fields structurally today.
- **Correction "after"-line computation correctness**: off-by-one on 1-based `originalLineNumber`, or a delta referencing a non-existent line. Mitigation: pure `applyCorrectionDeltas` helper with dedicated unit tests (matched delta, unmatched line unchanged, delta out of range ignored/guarded).
- **`updateOutcome` write-once branch**: the `sourceDocument`-present branch uses a guarded `.set(patch)`; confirm `issuedLineSnapshot` is carried when both are set on the issued patch (it is). Covered by a repo test asserting all three land on the same issued patch.
- **Migration ordering**: real-epoch prefix would sort mid-history. Mitigation: synthetic `1818000000003`; `pnpm lint` invariant enforces strictly-greater-than-main.

### Edge Cases
- Pre-migration issued record (snapshot `null`) -> order-derived fallback (unchanged behaviour).
- Correction whose original order is no longer resolvable and had no snapshot -> fallback path already returns `undefined` `originalDocument` (existing behaviour preserved).
- Correction-of-correction where the first correction was issued before this change (no snapshot) -> falls back to order-derived for that hop; once corrections persist snapshots, subsequent hops are exact.

### Backward Compatibility
- Fully compatible: nullable column, defaulted constructor param, additive patch/create fields, no API surface change, no adapter change.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **`invoice.service.spec.ts`**:
  - `issueInvoice` persists `issuedLineSnapshot = { buyer, currency, lines }` from the command on the successful issued patch.
  - `issueCorrection` with `originalDocument` present persists the post-correction "after" lines (deltas applied); with `originalDocument` absent persists `null`.
  - `applyCorrectionDeltas`: matched delta updates quantity/price; unmatched original line unchanged; out-of-range `originalLineNumber` guarded.
- **`invoicing.controller.spec.ts`**:
  - correction with a persisted snapshot assembles `OriginalDocumentSnapshot` from the snapshot and does **not** call `getOrderRecord`.
  - correction with no snapshot falls back to the order-derived path (existing behaviour).
  - correction-of-correction reads the prior correction record's snapshot.
  - `buyer` returned is a `BuyerProfile` instance.
- **Repository** (`*.spec.ts` or existing invoice-record int-spec): round-trip create + `updateOutcome` persists and reads `issuedLineSnapshot`; issued patch carrying `documentContent` + `sourceDocument` + `issuedLineSnapshot` together all land.

### Integration Tests
- Extend the existing invoicing int-spec (if present) to assert the column persists across a real issue; otherwise the repo round-trip unit test is sufficient for this additive column. No new Testcontainer suite required.

### Mocking Strategy
- Mock `InvoicingPort` / `CorrectionIssuer` and the repository port in service specs; mock `IInvoiceService` + `orders` in the controller spec. No real adapters.

### Acceptance Criteria (from #1297)
- [ ] `InvoiceRecord` persists an issuance-time line snapshot (buyer, currency, lines with name/quantity/unitPriceGross/taxRate) populated when `issueInvoice` succeeds.
- [ ] `buildOriginalDocumentSnapshot` reads from the persisted snapshot when present, falling back to order-derived reconstruction only for pre-migration records.
- [ ] Correcting a document whose backing order changed since issuance no longer produces mismatched `originalLineNumber` deltas.
- [ ] Correction-of-correction resolves its "before" snapshot from the document being corrected, not from the live order.
- [ ] Migration added for the new `InvoiceRecord` column and verified with `pnpm --filter @openlinker/api migration:show`.
- [ ] Tests added or updated for non-trivial logic.
- [ ] No architecture boundary violations (CORE <-> Integration).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no adapter changes)
- [x] Uses existing patterns (`documentContent`/`sourceDocument` precedent; no new abstractions)
- [x] Idempotency considered (snapshot is additive to the existing issued/correction patches; no new dedup surface)
- [ ] Event-driven patterns (n/a - no events)
- [ ] Rate limits & retries (n/a)
- [x] Error handling comprehensive (graceful fallback when snapshot absent)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

---

## ADR note

No new ADR is warranted. This is a persistence extension confined to the invoicing bounded context, touching no plugin contract and no cross-context surface - it operates within ADR-026 (country-agnostic invoicing) and follows the `documentContent`/`sourceDocument` (#1224) precedent. The one design fork (new column vs reusing `documentContent`) is captured in §7. Per docs/architecture/adrs/README.md, routine feature additions without cross-context/plugin-contract impact do not get an ADR.

## Related Documentation
- [Architecture Overview - Invoicing](../architecture-overview.md#14-invoicing)
- [Engineering Standards](../engineering-standards.md)
- [Migrations Guide](../migrations.md)
- ADR-026 (country-agnostic invoicing)
