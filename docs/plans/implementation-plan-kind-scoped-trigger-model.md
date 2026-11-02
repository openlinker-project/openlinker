# Implementation Plan: Kind-scoped auto-issue trigger model (#3582)

**Date**: 2026-11-02
**Status**: Draft / Ready for Review
**Estimated Effort**: ~1 day (core 2-3 h, web 3-4 h, docs/tests 1-2 h)
**Issue**: #3582, child 1 of 4 of epic #3515 (Pilot G10 - Batched sales-document issuing)
**Delivery**: lands on the epic branch `3515-batched-sales-document-issuing`, which becomes the single epic PR (`Closes #3515` + `Closes #3582/#3583/#3584/#3585`). This plan covers #3582 only.

---

## 1. Task Summary

**Objective**: Let one connection carry a separate auto-issue trigger model for each sales-document kind (`invoice`, `fiscal-receipt`), so an operator can batch invoices while issuing receipts at once. `AutoIssueTriggerService` reads the model belonging to the kind routing resolved for the order.

**Context**: `config.invoicing.triggerModel` is one value per connection, read for BOTH kinds (`auto-issue-trigger.service.ts` file header point 4, and `dispatchInvoice` / `dispatchFiscalReceipt` both call `parseTriggerModel(connection.config.invoicing?.triggerModel)`). `docs/architecture-overview.md` § 14 records this as *"a kind-scoped trigger-model key is a deferred, separate config-shape decision"*. #3583 (the batch run) makes that decision due: a connection with `documentKind: 'both'` (#3195) that batches invoices monthly must still issue receipts immediately, and one key cannot say that.

**Classification**: CORE (config coercion + gate read) + Frontend (sales-documents settings, Subiekt connection form) + Documentation.

---

## 2. Scope & Non-Goals

### In Scope
- A kind-keyed trigger-model map on `Connection.config` (JSONB, no migration).
- One pure resolver in core: kind-scoped key → legacy `config.invoicing.triggerModel` → `'manual'`.
- `AutoIssueTriggerService` reads the resolved model for the dispatched kind (both `dispatchInvoice` and `dispatchFiscalReceipt`).
- Sales-documents settings ("Connected providers" table): the Trigger column edits the per-kind value(s); a `'both'` row shows one control per kind.
- Every web writer of the trigger model writes the kind-scoped key, so no legacy write can silently stop taking effect (see § 8, Risk 1).
- Unit tests on both sides; docs update.

### Out of Scope
- The batch run itself, its schedule, the queue, run history, D42 (#3583).
- The batch issuing screen and the "Configure" link (#3584).
- Turning `'batched'` into a working value. It still throws `BatchedTriggerNotImplementedError` → `trigger-model-batched` block after this issue; #3583 changes that.
- Renaming `InvoiceTriggerModel` / `parseTriggerModel` to a kind-neutral name (a pure rename across ~20 files; not needed for the behaviour and it would bloat the epic diff).
- Server-side validation of the trigger-model values. None exists for the legacy key today; an unrecognised value already coerces to the safe `'manual'`.
- Rewriting existing configs. Read-compat only; no data migration.

### Constraints
- **No silent behaviour change** (AC 2): a connection that never touches the new key must issue exactly as before, for both kinds.
- `@openlinker/web` cannot import `@openlinker/core` (#591), so the fallback rule exists twice (core resolver + FE mirror) and both must agree.
- Same-PR epic: the change must not break the `trigger-model-batched` reporting #3583 will replace.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/invoicing/domain/types`, `libs/core/src/invoicing/application/services`, `libs/core/src/identifier-mapping/domain/types`), App/Web (`apps/web/src/features/sales-documents`, `apps/web/src/features/connections`, `apps/web/src/features/oms-onboarding`).

**Capabilities Involved**: none new. `InvoicingPort` / `FiscalizationPort` untouched; this is connection config read by the core gate.

**Existing Services Reused**:
- `parseTriggerModel` (`invoice-trigger.types.ts`) - kept as the value coercer; the new resolver calls it.
- `AutoIssueTriggerService.evaluateGate` - unchanged; only the model passed into it changes.
- `mergeSalesDocumentConfig` (web) - the single fetch-fresh-then-merge writer of the settings table; extended with one key.
- `deriveSalesDocumentRows` (web) - extended to expose effective per-kind models.

**New Components Required**:
- `resolveTriggerModelForKind(config, kind)` - pure resolver (core), returns the model and the rung that produced it.
- FE mirror `resolveTriggerModelForKind` in `apps/web/src/features/sales-documents/lib/`.

**Core vs Integration Justification**: the trigger model is OL's own issuance policy (ADR-041 gate), read by a core service. No adapter knows or should know about it. Placing the resolver in `invoicing/domain/types` (beside `parseTriggerModel`) follows the engineering-standards *pure-rule exception*: it is pure, it is the rule for the type beside it, and both change together.

---

## 4. External / Domain Research

### External System
None.

### Internal Patterns
- **Config coercion in one pure function**: `parseTriggerModel`, `readSalesDocumentRouting`, `readStockSafetyBuffer`, `readPricingRule`. The issue explicitly asks that *"the read-compat fallback lives in the pure coercer, not at each call site."*
- **Reporting where a value came from**: `ReportingCurrencySettingsView.source`, `OperationalSettingsView.source`, `resolveRoutingDecisionTtl().source` (#2731). The resolver returns `source: 'kind' | 'legacy' | 'default'` so a caller (and a future log/UI) can say which rung decided.
- **Kind namespace**: `config.salesDocument.documentKind` (ADR-041 decision 4) is the kind-neutral namespace; `config.invoicing.*` predates the two-kind split and is a historical misnomer for receipts.
- **Kinds per order**: a `'both'` connection expands into two routing candidates (`expandSalesDocumentRoutingCandidates`), and dispatch already branches on the resolved kind (`dispatchInvoice` / `dispatchFiscalReceipt`). The resolver therefore only needs the kind the gate already has.
- **FE mirrors guarded by invariant scripts** exist (`scripts/check-*-mirror.mjs`). See § 7 alternative 3 for why this rule does not get one.

---

## 5. Questions & Assumptions

### Open Questions
1. **Config key location and name.** Proposed: `config.salesDocument.triggerModels` keyed by kind (`{ invoice?: string; 'fiscal-receipt'?: string }`). Alternative: `config.invoicing.triggerModelByKind`. Assumed the former (see § 7, alternative 1). Easy to change before implementation; nothing else depends on the name.
2. **What the M15 `settings` state shows.** The mockup still has ONE schedule per connection (its note 3 says the split does not exist yet). #3582's AC asks for two independent controls on *the same sales-documents settings screen as #3584*. Assumed: this issue puts the per-kind controls in the existing "Connected providers" Trigger column; #3584 later puts the per-kind *schedules* on the batch screen and should reuse the same key. Worth confirming with whoever owns M15 that the mockup will be updated to two schedules.

### Assumptions
- **Precedence**: kind-scoped key (if it parses to a known model) → legacy `config.invoicing.triggerModel` (if it parses) → `'manual'`. An unrecognised kind-scoped value falls through to the legacy key rather than straight to `'manual'`, so a typo in a new key never silently disables issuing that the legacy key still enables. *Safe default.*
- **The legacy key stays read forever in this epic** and is never rewritten or deleted by a migration. A UI write only adds kind-scoped values.
- **Subiekt issues only `invoice`** (capability `Invoicing`; the paragon-vs-faktura choice is inside the adapter, not an ADR-041 kind). So its connection form maps onto the `invoice` key.
- **Unknown/open-world kinds** (ADR-041 decision 10) resolve through the same map key = kind string; no new code needed for a third kind.
- The `isPrimary` flag stays shared across kinds (ADR-041 decision 4); this issue does not split it.

### Documentation Gaps
- `docs/architecture-overview.md` § 14 (cross-capability auto-issue gate bullet) states the single-key behaviour; must be rewritten.
- `connection.types.ts` docblock on `invoicing.triggerModel` describes it as THE key.
- Subiekt / Subiekt nexo setup guides and runbooks name `config.invoicing.triggerModel`; they stay true (legacy still read) but should mention the kind-scoped key.

---

## 6. Proposed Implementation Plan

### Phase 1: Core - shape and resolver
**Goal**: one pure rule that answers "which trigger model applies to this kind on this connection", with the legacy fallback.

1. **Document the config shape**
   - **File**: `libs/core/src/identifier-mapping/domain/types/connection.types.ts`
   - **Action**: add `triggerModels?: Record<string, string>` under `salesDocument` (beside `documentKind`), typed as `string` values like the legacy key, to keep `identifier-mapping` decoupled from the invoicing enum. Rewrite the `invoicing.triggerModel` docblock: now the LEGACY fallback, read only when the kind-scoped key is absent/unrecognised.
   - **Acceptance**: type-check passes; no reader changes yet.

2. **Add the resolver**
   - **File**: `libs/core/src/invoicing/domain/types/invoice-trigger.types.ts`
   - **Action**: add
     ```ts
     export const TriggerModelSourceValues = ['kind', 'legacy', 'default'] as const;
     export type TriggerModelSource = (typeof TriggerModelSourceValues)[number];
     export interface ResolvedTriggerModel { model: InvoiceTriggerModel; source: TriggerModelSource }
     export function resolveTriggerModelForKind(config: unknown, kind: SalesDocumentKind): ResolvedTriggerModel
     ```
     Reads `config.salesDocument.triggerModels[kind]`, then `config.invoicing.triggerModel`, using an internal `isInvoiceTriggerModel` check (not `parseTriggerModel`, which collapses "unrecognised" into `'manual'` and would hide the legacy fallback). `config` is `unknown` and narrowed defensively (JSONB). `SalesDocumentKind` is imported type-only from `@openlinker/core/sales-documents` (invoicing already depends on that leaf; no new edge). Update the file header: `batched` is still deferred to #3583; the model is now per kind.
   - **Acceptance**: unit table (Phase 4, step 1) passes.
   - **Dependencies**: step 1.

3. **Export it**
   - **File**: `libs/core/src/invoicing/index.ts` (check whether `invoice-trigger.types` is already re-exported; add the new symbols if the barrel cherry-picks).
   - **Acceptance**: `@openlinker/core/invoicing` exposes `resolveTriggerModelForKind`.

### Phase 2: Core - the gate reads per kind
**Goal**: the issuing decision uses the model for the kind being issued.

1. **Read per kind in both dispatch paths**
   - **File**: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts`
   - **Action**: replace `parseTriggerModel(connection.config.invoicing?.triggerModel)` in `dispatchInvoice` with `resolveTriggerModelForKind(connection.config, 'invoice').model`, and in `dispatchFiscalReceipt` with `...('fiscal-receipt')`. Rewrite file-header point 4 and the comment above the fiscal read ("Reused verbatim…") to describe the kind-scoped resolution and its legacy fallback. `composeInvoicePayload` keeps receiving the resolved model (it is threaded into the payload today - verify the field and keep it).
   - **Acceptance**: unit tests (Phase 4, step 2) pass; existing spec cases with only the legacy key stay green unchanged - that is the "no silent behaviour change" proof.
   - **Dependencies**: Phase 1.

2. **`warnOnceIfManualWinnerDisablesInstall`** - unchanged signature; it now receives the per-kind model, which is the correct input (a `'both'` connection may be manual for one kind only). Check its message names the kind if it can be misread; add the kind to the log line if so.

### Phase 3: Web - settings and every writer
**Goal**: an operator can set the two models independently, and every UI path writes the key that takes effect.

1. **FE mirror of the resolver**
   - **File**: `apps/web/src/features/connections/lib/resolve-trigger-model-for-kind.ts` (+ `.test.ts`), re-exported from the `connections` barrel (the Subiekt form in `connections` needs it, and `connections` must not import `sales-documents`)
   - **Action**: same precedence over `Record<string, unknown>` config, using `INVOICE_TRIGGER_MODEL_VALUES` from `features/connections` (already imported by `oms-onboarding`). Header states it mirrors `resolveTriggerModelForKind` in core and that both tests share the same case table.
   - **Acceptance**: tests mirror core's table case for case.

2. **Rows expose effective per-kind models**
   - **Files**: `apps/web/src/features/sales-documents/api/sales-documents.types.ts`, `.../lib/derive-sales-document-rows.ts` (+ test)
   - **Action**: replace `SalesDocumentRow.triggerModel: string` with `triggerModels: Record<ConcreteDocumentKind, string>` holding the EFFECTIVE (resolved) model per kind. Showing the effective value rather than the raw key is deliberate: the select must display what the gate will enforce (reported === enforced, #2229), including an inherited legacy value.
   - **Acceptance**: a legacy-only config yields the same value for both kinds; a kind-scoped value overrides only its kind.

3. **Patch + merge write the kind-scoped key**
   - **Files**: `.../api/sales-documents.types.ts` (`SalesDocumentConfigPatch`), `.../lib/merge-sales-document-config.ts` (+ test)
   - **Action**: replace `triggerModel?: string` with `triggerModel?: { kind: ConcreteDocumentKind; value: string }`; merge writes `salesDocument.triggerModels[kind] = value`, preserving the other kind's entry and every other `salesDocument` / `invoicing` key. The legacy `invoicing.triggerModel` is left as is (it may still be the fallback for the other kind).
   - **Acceptance**: setting the invoice model leaves an existing receipt entry and the legacy key untouched.

4. **Trigger column per kind**
   - **File**: `apps/web/src/features/sales-documents/components/sales-documents-panel.tsx` (+ test)
   - **Action**: the Trigger cell renders one select per kind the row issues: `documentKind` `invoice` → one select (invoice key), `fiscal-receipt` → one select (receipt key), `both` → two selects, each with a visible short label ("Invoices" / "Receipts") and its own `aria-label` (`When {name} issues invoices` / `... receipts`); `null` → one disabled select as today. Keep the existing "disabled when not primary" rule. Update the footnote under the table.
   - **Acceptance**: changing the receipt select on a `both` row PATCHes only `salesDocument.triggerModels['fiscal-receipt']`.

5. **Onboarding readiness check**
   - **File**: `apps/web/src/features/oms-onboarding/lib/setup-steps.ts` (+ test)
   - **Action**: `hasAutomaticDocumentIssuing` reads `row.triggerModels` for the kinds the row actually issues (`both` → either kind), instead of `row.triggerModel`.
   - **Acceptance**: a `both` row with receipts `auto-on-paid` and invoices `manual` counts as automatic.

6. **Subiekt connection form writes the key that takes effect**
   - **Files**: `apps/web/src/features/connections/components/EditConnectionForm.tsx` (`readTriggerModel`), `.../edit-connection.schema.ts` (the `subiektTriggerModel` merge), `.../subiekt-setup.schema.ts` (create payload), plus their tests (`edit-connection.subiekt.test.ts`, setup schema test).
   - **Action**: read the EFFECTIVE `invoice` model (kind key → legacy → `manual`, via a small helper or the mirror from step 1 if the import direction allows; `connections` must not import `sales-documents` - if it would, place the shared mirror in `features/connections/lib` and re-export it to `sales-documents`, which already imports `connections`). Write `salesDocument.triggerModels.invoice`; clearing the field deletes that entry (and drops an emptied `triggerModels` / `salesDocument` object only if nothing else is in it - `documentKind` must survive).
   - **Acceptance**: editing the trigger on a Subiekt connection whose panel already set an invoice key changes the effective value (the existing test "writes the trigger model to config.invoicing.triggerModel" is rewritten to assert the new key).
   - **Why**: see § 8, Risk 1.

### Phase 4: Tests
1. **Core resolver table** - `libs/core/src/invoicing/domain/types/invoice-trigger.types.spec.ts` (new or extend): nothing set → `manual`/`default`; legacy only → legacy value for BOTH kinds/`legacy`; kind set → that value/`kind`, other kind falls back to legacy; kind value unrecognised → legacy; both unrecognised → `manual`; `config` not an object / `salesDocument` not an object / `triggerModels` not an object → treated as absent; an open-world third kind reads its own key.
2. **Gate** - `libs/core/src/invoicing/application/services/__tests__/auto-issue-trigger*.spec.ts`: (a) legacy-only `auto-on-paid` still enqueues for invoice AND receipt (regression, AC 2); (b) `both`-style setup: invoice `batched` + receipt `auto-on-paid` → a receipt-routed paid order enqueues `fiscalization.register`, an invoice-routed order reports `trigger-model-batched`; (c) kind key overrides legacy for its kind only.
3. **Web** - the tests listed per step in Phase 3.

### Phase 5: Docs
- `docs/architecture-overview.md` § 14: rewrite the sentence *"The per-connection `config.invoicing.triggerModel` key is read for BOTH kinds (… deferred …)"* to describe `salesDocument.triggerModels[kind]` with the legacy fallback, citing #3582.
- Subiekt + Subiekt nexo setup guides / runbooks: one line that the kind-scoped key takes precedence over `config.invoicing.triggerModel`.
- `docs/lessons.md`: nothing expected; add an entry only if implementation surfaces a regression worth recording.

### Implementation Details

**New Components**:
- **Domain**: `resolveTriggerModelForKind`, `TriggerModelSource`, `ResolvedTriggerModel` (in the existing `invoice-trigger.types.ts`).
- **Application**: none; `AutoIssueTriggerService` changes two reads.
- **Infrastructure**: none.
- **Interface (web)**: FE resolver mirror; row/patch type changes; panel cell.

**Configuration Changes**: `Connection.config.salesDocument.triggerModels` (JSONB). No env vars.

**Database Migrations**: none (JSONB; read-compat in the coercer).

**Events**: none emitted or consumed.

**Error Handling**: no new exceptions. Malformed values degrade through the precedence chain to `'manual'` (safe: nothing is auto-issued that the operator did not ask for), matching `parseTriggerModel`'s existing contract.

---

## 7. Alternatives Considered

### Alternative 1: `config.invoicing.triggerModelByKind`
- **Description**: keep everything under `invoicing`.
- **Why Rejected**: `invoicing` is already a misnomer for receipts; ADR-041 decision 4 put the kind in `salesDocument`. Adding a kind-keyed map under `invoicing` deepens the misnomer for the one key whose whole point is "not only invoices".
- **Trade-offs**: would keep the legacy key and the new map adjacent; marginally simpler merge code. Not worth the naming debt.

### Alternative 2: Data migration that copies the legacy key into both kind keys and deletes it
- **Description**: one-shot rewrite, then read only the new key.
- **Why Rejected**: the issue asks for read-compat in the coercer; a migration over JSONB config is irreversible in spirit (a `down()` cannot know which kind keys were operator-set vs copied), and out-of-tree setup flows (Subiekt guides, MCP, curl) keep writing the legacy key, which would then silently do nothing.
- **Trade-offs**: one fewer fallback rung forever, at the price of a breaking change for every external writer.

### Alternative 3: A `scripts/check-trigger-model-resolver-mirror.mjs` invariant
- **Description**: guard the FE mirror against drift like the other mirrors.
- **Why Rejected (for now)**: the existing mirror scripts compare value sets or arithmetic that a text check can see; this rule is three lines of precedence that a text diff cannot meaningfully compare, and the value set it depends on is already mirrored (`INVOICE_TRIGGER_MODEL_VALUES`). Mirrored test tables are the proportionate guard.
- **Trade-offs**: a future precedence change must touch both tests; stated in both file headers.

### Alternative 4: Expose the effective models from the API instead of mirroring
- **Description**: `GET` a sales-document settings view that already contains resolved per-kind models.
- **Why Rejected**: the panel reads raw connections today (`deriveSalesDocumentRows`) and has no backend view; adding one is a larger change than the mirror. Reconsider if #3584's batch screen needs a backend view anyway.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Pure rule in `domain/types`, no framework imports.
- ✅ No new cross-context edge (invoicing → sales-documents type-only import already exists).
- ✅ `sales-documents` stays a zero-outbound-edge leaf; nothing is added to it.

### Naming Conventions
- ✅ `*.types.ts` pure-rule exception; `as const` unions; kebab-case web files; `use-*`/`*.test.ts` unchanged conventions.

### Existing Patterns
- ✅ Coercer pattern (`parseTriggerModel`, `readSalesDocumentRouting`), source-rung reporting (#2660/#2731), fetch-fresh-then-merge config writes (#2159).

### Risks
- **Risk 1 - a legacy writer stops taking effect.** Once a kind key exists it shadows the legacy key. If the Subiekt form kept writing `invoicing.triggerModel`, an operator editing it there would see "saved" while the gate kept using the panel's value. Mitigation: Phase 3 step 6 moves every web writer to the kind key, and the effective value is what both screens display. Residual: an external writer (curl/MCP, docs) can still hit the shadowed legacy key; docs updated, and the resolver's `source` makes the cause diagnosable.
- **Risk 2 - `'both'` connections changing kind.** If an operator switches a row from `invoice` to `fiscal-receipt`, the receipt key may be unset and fall back to the legacy value, which can differ from what the invoice select showed. Mitigation: the select always shows the effective value, so the operator sees what will apply right after the switch.
- **Risk 3 - epic sequencing.** #3583 changes the `'batched'` arm of `evaluateGate`; this issue does not touch it, so the two changes compose without conflict.

### Edge Cases
- `config` / `salesDocument` / `triggerModels` not objects (bad JSONB) → treated as absent.
- Blank-string values → treated as absent (matches FE `derive-sales-document-rows` today).
- Kind key set, legacy absent → kind value; other kind → `'manual'`.
- Non-primary rows: still editable only when primary (unchanged UI rule); the gate only reads the winning connection anyway.

### Backward Compatibility
- ✅ A config with only `invoicing.triggerModel` resolves to the same model for both kinds as before. Proven by keeping existing gate specs unchanged plus the explicit regression case.
- ✅ No API, DTO, migration or persisted-reason change.
- ⚠️ Web-internal type change (`SalesDocumentRow.triggerModel` → `triggerModels`); all consumers are in-repo and covered in Phase 3.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- Core resolver table and gate cases (Phase 4).
- **Files**: `libs/core/src/invoicing/domain/types/invoice-trigger.types.spec.ts`, `libs/core/src/invoicing/application/services/__tests__/auto-issue-trigger*.spec.ts`
- Web: resolver mirror, derive rows, merge config, panel, setup steps, Subiekt edit/setup schema.

### Integration Tests
- None required: no repository, migration or HTTP surface changes. `pnpm test:integration` is not needed for this child (it will be for #3583's migration).

### Mocking Strategy
- Gate specs keep the existing mocked `ConnectionPort` / `SyncJobsService`; only connection `config` fixtures change. Web tests use `renderWithProviders` + `createMockApiClient`.

### Acceptance Criteria (from #3582)
- [ ] `Connection.config` carries distinct trigger-model keys for `invoice` and `fiscal-receipt` (`salesDocument.triggerModels`).
- [ ] Single-key configs read unchanged for both kinds (regression spec).
- [ ] `AutoIssueTriggerService` resolves the model for the resolved `SalesDocumentKind`.
- [ ] Sales-documents settings let an operator configure the two independently (`both` row shows two controls).
- [ ] Tests added (core + web).
- [ ] No CORE ↔ Integration boundary violations; `pnpm lint` (incl. `check:invariants`) and `pnpm type-check` green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (no change to job keys `invoice:{conn}:{order}` / `fiscal:{conn}:{order}`)
- [x] Event-driven patterns used where applicable (n/a)
- [x] Rate limits & retries addressed (n/a)
- [x] Error handling comprehensive (degrade-to-manual chain)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview § 14 Invoicing / § 17 Sales Documents](../architecture-overview.md)
- [ADR-041 Sales document routing policy](../architecture/adrs/041-sales-document-routing-policy.md)
- [Engineering Standards - pure-rule exception](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
