# Implementation Plan: KSeF default tax-rate fallback (fix #1290)

**Date**: 2026-07-01
**Status**: Ready for Review
**Estimated Effort**: 2-3 hours

> **Superseded during implementation** (PR #1291 review): two points below diverged
> from what shipped. `defaultTaxRate` landed on `Fa3MappingContext` (adapter-scoped
> issuance policy), not on `SellerProfile` (seller identity) as step 3 and its
> acceptance criterion describe. A config-shape validator was also added (rejecting
> empty/whitespace-only `defaultTaxRate` at save time), contradicting the "no
> separate config-shape validation is added" assumption below. See the shipped code
> for the current design.

---

## 1. Task Summary

**Objective**: Fix `UnmappedTaxRateException` thrown on every real KSeF invoice issuance and correction, caused by `InvoiceLine.taxRate` always being an empty string.

**Context**: `toIssueInvoiceCommand` in core (`libs/core/src/invoicing/`) intentionally emits `taxRate: ''` on every line — core is country-agnostic (ADR-026) and has no per-line tax-rate data on `OrderItem`. Its doc comment says the provider adapter is supposed to resolve the regime rate, but no code in the KSeF package ever did that: `resolveP12('')` always throws `UnmappedTaxRateException` since `FA3_TAX_RATE_MAP` has no `''` key (by design — no silent defaults for genuinely unmapped codes). This blocks every issuance and every correction against a live/sandbox KSeF connection today. See issue #1290 for full root-cause trace.

**Classification**: Integration (confined entirely to `libs/integrations/ksef`) — no core changes.

---

## 2. Scope & Non-Goals

### In Scope
- Add a per-connection `defaultTaxRate` to the KSeF seller config, threaded through to `SellerProfile`.
- Apply that default only when the neutral `taxRate` is the empty string, before calling `resolveP12`.
- Keep `resolveP12` throwing for genuinely unmapped non-empty codes — no silent default there.
- Apply the same default to correction lines (`mapCorrection`'s `correctedLines`).
- Document the flat-default limitation.
- Unit tests for the new fallback behavior.

### Out of Scope
- A real per-line tax rate on `OrderItem` / `IncomingOrderItem` (core order-ingestion schema change) — much larger, cross-cutting change, tracked as a future follow-up in the issue's Assumptions.
- Any change to `libs/core/src/invoicing/**` — core's `taxRate: ''` emission is correct as-is.
- Real per-seller sequential invoice numbering (#1118) — unrelated pre-existing gap, not touched here.

### Constraints
- Must not change `resolveP12`'s existing contract (all 10 mapped values + throw-on-unknown/empty) — it's covered by an existing complete spec (`fa3-tax-rate.mapper.spec.ts`) that must keep passing unmodified.
- Must not introduce PL/KSeF vocabulary into `libs/core` (ADR-026).

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/ksef`), infrastructure sub-layer (FA(3) mapping) + application (adapter factory, connection-config resolution).

**Capabilities Involved**: None new — `InvoicingPort` / `CorrectionIssuer` are unchanged; this is an internal mapping fix inside the existing KSeF adapter.

**Existing Services Reused**:
- `KsefAdapterFactory.resolveSeller` (already resolves `SellerProfile` from `Connection.config`) — extended, not replaced.
- `mapToFa3BuilderInput` / `mapLine` (already the single seam between the neutral command and the FA(3) line shape) — extended, not replaced.

**New Components Required**: None — no new files. All changes extend existing types/functions in place.

**Core vs Integration Justification**: The fix belongs entirely in the KSeF adapter package because the default VAT rate is a PL-specific business rule (KSeF requires a `P_12` value on every line; "23%" is the PL standard rate). Core stays free of this vocabulary per ADR-026 — it correctly has no opinion on what a line's tax rate should default to.

**Reference**: [Architecture Overview - Invoicing](../architecture-overview.md#14-invoicing)

---

## 4. External / Domain Research

### Internal Patterns
- The `invoiceNumber: cmd.orderId` placeholder in `KsefInvoicingAdapter.issueInvoice` (documented TODO citing #1118) is the precedent for "accepted MVP limitation, documented inline + in `FA3_IMPLEMENTATION_NOTES.md`, not silently hidden."
- `KsefAdapterFactory.resolveSeller` already fails fast (`KsefConfigException`) when required seller fields are missing — the new `defaultTaxRate` field follows the same connection-config resolution path but is **optional with a fallback**, not required, since a sensible default (`'23'`) exists.

---

## 5. Questions & Assumptions

### Open Questions
- None — the fallback design was pre-agreed with the user before this plan was written (issue #1290's Proposed Solution).

### Assumptions
- `'23'` (standard PL VAT rate) is the right fallback default when a connection doesn't configure `defaultTaxRate` — matches the existing test fixtures across the KSeF package, all of which already hardcode `taxRate: '23'`.
- `defaultTaxRate` is validated as "must be a key in `FA3_TAX_RATE_MAP`" only implicitly (via `resolveP12` still being called with it) — no separate config-shape validation is added, since an operator who misconfigures it gets the same loud `UnmappedTaxRateException` as before, just against their own bad config instead of always against `''`.

### Documentation Gaps
- None found — `FA3_IMPLEMENTATION_NOTES.md` already has a "P_12 tax-rate mapping" section that documents the working table; this plan adds a "default fallback" note there.

---

## 6. Proposed Implementation Plan

### Phase 1: Thread `defaultTaxRate` through connection config → `SellerProfile`

**Goal**: A KSeF connection can (optionally) configure a fallback VAT rate; `SellerProfile` always carries a resolved value.

**Steps**:

1. **Add `defaultTaxRate` to `KsefSellerConfig`**
   - **File**: `libs/integrations/ksef/src/domain/types/ksef-connection.types.ts`
   - **Action**: Add `defaultTaxRate?: string;` to the `KsefSellerConfig` interface, with a doc comment explaining it's the neutral tax-rate code (matching `FA3_TAX_RATE_MAP` keys, e.g. `'23'`) applied to any invoice line whose neutral `taxRate` is empty. Optional — falls back to the PL standard rate when absent.
   - **Acceptance**: Type compiles; no other file needs to change yet (optional field).

2. **Export the fallback constant from the tax-rate mapper**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-tax-rate.mapper.ts`
   - **Action**: Add `export const DEFAULT_FA3_TAX_RATE = '23';` near `FA3_TAX_RATE_MAP` (single source of truth for the PL standard-rate fallback). `resolveP12` itself is **not modified** — it keeps throwing on `''` and on unknown codes exactly as today; the existing spec (`fa3-tax-rate.mapper.spec.ts`) stays green unmodified.
   - **Acceptance**: `pnpm test fa3-tax-rate.mapper.spec.ts` still passes with zero changes to that spec file.

3. **Make `SellerProfile.defaultTaxRate` a required field**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-xml.types.ts`
   - **Action**: Add `defaultTaxRate: string;` to `SellerProfile` (required, not optional — by the time a `SellerProfile` exists, the factory has already resolved a concrete value, defaulting or not).
   - **Acceptance**: TypeScript flags every `SellerProfile` literal in the package that doesn't set it (adapter spec fixtures, builder spec fixtures) — fixed in Phase 3.

4. **Resolve `defaultTaxRate` in the adapter factory**
   - **File**: `libs/integrations/ksef/src/application/factories/ksef-adapter.factory.ts`
   - **Action**: In `resolveSeller`, after building the existing `nip`/`name`/`address` fields, add: `defaultTaxRate: seller.defaultTaxRate?.trim() || DEFAULT_FA3_TAX_RATE`. Import `DEFAULT_FA3_TAX_RATE` from `../../infrastructure/fa3/domain/fa3-tax-rate.mapper`.
   - **Acceptance**: A connection with no `defaultTaxRate` configured resolves `SellerProfile.defaultTaxRate === '23'`; a connection with `defaultTaxRate: '8'` resolves `'8'`.

### Phase 2: Apply the default in the FA(3) line mapper

**Goal**: An empty neutral `taxRate` resolves through the connection's default before `resolveP12` runs — for both a normal invoice line and a correction's before/after lines.

**Steps**:

5. **Thread `defaultTaxRate` into `mapLine`**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-builder-input.mapper.ts`
   - **Action**: Change `mapLine(line: InvoiceLine): Fa3Line` to `mapLine(line: InvoiceLine, defaultTaxRate: string): Fa3Line`. Inside, compute `const taxRate = line.taxRate || defaultTaxRate;` and call `resolveP12(taxRate)` instead of `resolveP12(line.taxRate)`. Update both call sites:
     - `mapToFa3BuilderInput`'s `cmd.lines.map(mapLine)` → `cmd.lines.map((line) => mapLine(line, context.seller.defaultTaxRate))`
     - `mapCorrection`'s `correction.correctedLines.map(mapLine)` → same pattern, threading `context.seller.defaultTaxRate` down from `mapToFa3BuilderInput` into `mapCorrection(cmd.correction, context.seller.defaultTaxRate)` (add the parameter to `mapCorrection` too).
   - **Acceptance**: An `InvoiceLine` with `taxRate: ''` and a `SellerProfile.defaultTaxRate` of `'8'` produces `Fa3Line.p12 === '8'`. An `InvoiceLine` with `taxRate: 'not-a-rate'` (non-empty, unmapped) still throws `UnmappedTaxRateException` — the default never masks a real mismatch.

6. **Document the limitation**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/FA3_IMPLEMENTATION_NOTES.md`
   - **Action**: Under the existing "P_12 tax-rate mapping" section, add a short note: core never supplies a real per-line tax rate today (`OrderItem` has none), so every line on a connection without a multi-rate order falls back to `SellerProfile.defaultTaxRate` (PL standard `'23'` unless configured otherwise). A genuinely mixed-rate order (23%/8%/0% goods in one order) will be mis-taxed on the non-default-rate lines until a real per-item tax rate exists end-to-end (tracked as a follow-up, out of scope for #1290).
   - **Acceptance**: Note is present and accurate; no code change.

### Phase 3: Fix existing fixtures + add new tests

**Steps**:

7. **Fix `SellerProfile` literals broken by the new required field**
   - **Files**: `libs/integrations/ksef/src/infrastructure/adapters/__tests__/ksef-invoicing.adapter.spec.ts`, `libs/integrations/ksef/src/infrastructure/fa3/builders/fa3-xml.builder.spec.ts`, `libs/integrations/ksef/src/infrastructure/fa3/validators/fa3-xsd.validator.spec.ts` (wherever `SellerProfile` literals exist)
   - **Action**: Add `defaultTaxRate: '23'` to each `SellerProfile` test fixture.
   - **Acceptance**: `pnpm type-check` passes with zero errors.

8. **Add fallback-path unit tests**
   - **File**: `libs/integrations/ksef/src/infrastructure/fa3/domain/fa3-builder-input.mapper.spec.ts` (new file — none exists today)
   - **Action**: Cover:
     - `mapToFa3BuilderInput` maps a line with `taxRate: ''` to `p12` equal to the seller's `defaultTaxRate`.
     - `mapToFa3BuilderInput` maps a line with a non-empty mapped `taxRate` (e.g. `'8'`) to `p12 === '8'` regardless of `defaultTaxRate` (default never overrides an explicit rate).
     - `mapToFa3BuilderInput` still throws `UnmappedTaxRateException` for a non-empty unmapped `taxRate` (e.g. `'bogus'`), even when a `defaultTaxRate` is configured.
     - A correction's `correctedLines` also receive the fallback (construct a `cmd.correction.correctedLines` entry with `taxRate: ''`, assert the resulting `Fa3CorrectionContext.correctedLines[].p12`).
   - **Acceptance**: All four cases pass; `fa3-tax-rate.mapper.spec.ts` unchanged and still green.

9. **Add a factory-level test for `resolveSeller`'s default behavior**
   - **File**: `libs/integrations/ksef/src/application/factories/ksef-adapter.factory.spec.ts` (create if it doesn't exist, or extend if it does — check first)
   - **Action**: Cover: connection with no `config.seller.defaultTaxRate` resolves `'23'`; connection with `config.seller.defaultTaxRate: '8'` resolves `'8'`; connection with `defaultTaxRate: '  '` (whitespace-only) resolves `'23'` (the `.trim() ||` fallback).
   - **Acceptance**: All three cases pass.

---

## 7. Alternatives Considered

### Alternative 1: Default inside `resolveP12` itself
Change `resolveP12(neutralTaxRate: string, fallback?: string)` to accept an optional fallback and apply it internally for the `''` case.
- **Why Rejected**: `resolveP12`'s existing spec explicitly pins "empty rate throws" as a hard invariant (`fa3-tax-rate.mapper.spec.ts` line 35-37, described in its own header comment as "an unknown/empty code throws — never a silent default"). Changing that contract in the pure mapper conflates two concerns (rate resolution vs. defaulting policy) in one function and would require rewriting an already-complete, intentionally strict spec. Keeping the default at the `mapLine` call site is a smaller, additive change that leaves `resolveP12` exactly as documented.

### Alternative 2: Add `taxRate` to `OrderItem` / `IncomingOrderItem` now (the "real" fix)
Plumb a genuine per-line tax rate from order ingestion through core into the invoice line.
- **Why Rejected**: Far larger blast radius — touches every order-source adapter (Allegro, PrestaShop, WooCommerce, Erli), the core `Order`/`OrderItem` contract, and every consumer of `OrderItem`. Not needed to unblock the immediate, confirmed-live bug (every KSeF issuance failing outright); the flat per-connection default is a proportionate MVP fix. Tracked explicitly as a follow-up in issue #1290's Assumptions rather than silently deferred.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No core changes — `libs/core/src/invoicing/**` untouched, confirming ADR-026 (core stays country-agnostic).
- ✅ PL-specific default value (`'23'`) lives entirely inside `libs/integrations/ksef`.

### Naming Conventions
- ✅ `DEFAULT_FA3_TAX_RATE` follows `UPPER_SNAKE_CASE` constant convention.
- ✅ New field names (`defaultTaxRate`) are `camelCase`, consistent with sibling fields on `KsefSellerConfig`/`SellerProfile`.

### Existing Patterns
- ✅ Mirrors the `invoiceNumber: cmd.orderId` documented-placeholder pattern already in `KsefInvoicingAdapter`.
- ✅ `resolveSeller`'s fail-fast-on-missing-required-field pattern is preserved; `defaultTaxRate` is additive and optional, not a new failure mode.

### Risks
- **Silent mis-taxing on multi-rate orders**: an order mixing 23%/8%/0% goods will tax every line at the connection default unless core ever supplies a real per-line rate. Mitigated by the explicit `FA3_IMPLEMENTATION_NOTES.md` documentation (Phase 2, step 6) — this is a known, accepted MVP limitation, not a silent bug.
- **A misconfigured `defaultTaxRate` (e.g. a typo) still throws `UnmappedTaxRateException`** — this is by design (the risk is intentional: fail loud on bad config rather than defaulting-of-defaults).

### Edge Cases
- Whitespace-only `defaultTaxRate` in connection config → falls back to `DEFAULT_FA3_TAX_RATE` via `.trim() ||`.
- A line with an explicit (non-empty) `taxRate` never gets the default applied, even if it happens to also be unmapped — the failure mode for a genuine typo is unchanged.

### Backward Compatibility
- ✅ Existing connections with no `defaultTaxRate` configured behave identically to a connection that explicitly configures `'23'` — no migration needed (`KsefConnectionConfig` / `Connection.config` is a `jsonb` blob; the new field is additive and optional).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `fa3-builder-input.mapper.spec.ts` (new): empty-taxRate fallback, explicit-rate no-override, non-empty-unmapped still throws, correction lines also get the fallback.
- `ksef-adapter.factory.spec.ts`: `resolveSeller` default-resolution behavior (absent / configured / whitespace-only `defaultTaxRate`).
- `fa3-tax-rate.mapper.spec.ts`: **unchanged** — proves `resolveP12`'s contract wasn't touched.
- `ksef-invoicing.adapter.spec.ts`: fixture update only (add `defaultTaxRate: '23'` to the `SELLER` const) — no new test needed here, since the adapter's own line-building already passes explicit `taxRate: '23'` and doesn't exercise the empty-string path.

### Integration Tests
- None required — this is a pure mapping-layer fix with full unit coverage; no new HTTP/DB surface.

### Mocking Strategy
- No ports involved; the affected functions are pure mappers plus one config-resolution method. No mocks beyond what the existing specs already use (fake HTTP client, in-memory `Connection` fixtures).

### Acceptance Criteria
- [ ] A real KSeF invoice issuance (`POST /invoices`) against a live/sandbox KSeF connection succeeds without `UnmappedTaxRateException` (manually verified against the dev sandbox, same order/connection used during #1290's investigation).
- [ ] A real KSeF correction (`POST /invoices/:id/correct`) against the same connection succeeds without `UnmappedTaxRateException`.
- [ ] `resolveP12` still throws `UnmappedTaxRateException` for a genuinely unmapped non-empty tax-rate code.
- [ ] The flat-default limitation is documented in `FA3_IMPLEMENTATION_NOTES.md`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm type-check` all pass with zero errors/failures.
- [ ] No architecture boundary violations — `libs/core` untouched; PL vocabulary stays in `libs/integrations/ksef`.

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (n/a — pure mapping fix, no new side effects)
- [x] Event-driven patterns used where applicable (n/a)
- [x] Rate limits & retries addressed (n/a — no new I/O)
- [x] Error handling comprehensive (resolveP12's throw path preserved for genuine mismatches)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue: https://github.com/openlinker-project/openlinker/issues/1290
