# Implementation Plan: Infakt `payment_method` — per-connection config instead of hardcoded/inconsistent literals

**Date**: 2026-07-02
**Status**: Ready for Review
**Estimated Effort**: 2-3 hours

---

## 1. Task Summary

**Objective**: Fix [#1303](https://github.com/openlinker-project/openlinker/issues/1303) — `InfaktInvoicingAdapter` hardcodes `payment_method` independently at each call site (`issueInvoice` currently `'transfer'` on `main`, `issueCorrection` `'cash'`), and neither is derived from any real signal.

**Context**: `'transfer'` 422s on Infakt unless the seller has a bank account configured on the Infakt side — a fact OL cannot observe or configure per-connection today. "Cash" vs "transfer" carries real fiscal meaning in Poland, so silently mislabeling (or disagreeing between the two call sites) is a correctness gap, even if currently low-impact.

**Classification**: Integration (Infakt plugin only — no CORE change).

---

## 2. Scope & Non-Goals

### In Scope
- A per-connection `defaultPaymentMethod` config field (`'cash' | 'transfer'`) on `InfaktConnectionConfig`, consumed identically by `issueInvoice` and `issueCorrection`.
- Config-shape validation for the new field.
- Documentation (code comments + this plan) of the `'transfer'` bank-account prerequisite.
- Unit tests covering both adapter methods and the shape validator.

### Out of Scope
- A neutral `paymentMethod` field on `IssueInvoiceCommand`/`IssueCorrectionCommand` in `libs/core/src/invoicing` (Option 1 from the issue) — see § Alternatives Considered for why it's rejected.
- A structured FE config-section field for `defaultPaymentMethod` (the existing raw-JSON config editor in `EditConnectionForm` already lets an operator set it; a dedicated `<Select>` in `InfaktStructuredSection` is a natural but separate follow-up, not required by the issue's stated File(s) scope).
- Runtime verification against Infakt of whether a bank account is actually configured (no such read endpoint is integrated) — the prerequisite is documented, and picking `'transfer'` is an explicit opt-in the operator makes with that documentation in front of them.
- Other Infakt payment methods (card, etc.) — explicitly out of scope per the issue.

### Constraints
- Must not touch KSeF or Subiekt adapters — no core contract exists for this, and forcing dead mapping code into either would violate "don't blur the boundary for convenience."
- Backward compatible: existing connections with no `defaultPaymentMethod` must keep behaving exactly as `issueCorrection` does today (`'cash'`, safe default).

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/infakt/`) only.

**Capabilities Involved**: None new — `InvoicingPort` / `CorrectionIssuer` are unchanged.

**Existing Services Reused**: `InfaktAdapterFactory`, `ConnectionConfigShapeValidatorRegistryService` (already registers `InfaktConnectionConfigShapeValidatorAdapter` at `infakt.accounting.v1`).

**New Components Required**: none — all changes are to existing files.

**Core vs Integration Justification**: Confirmed via codebase research — `Order` carries a `paymentStatus` axis (`'paid' | 'cod' | 'awaiting' | 'refunded'`, a payment-*state* signal) but nothing resembling a payment-*method* axis (transfer/cash/card). There is no real order-level signal to populate a core `paymentMethod` field with; inventing one would be worse than the status quo, and no adapter (KSeF, Subiekt) has any existing payment-method mapping logic to reuse or extend. The bug's actual root cause is narrower and entirely local to Infakt: `InfaktConnectionConfig` already models exactly this kind of per-connection knob (`baseUrl`), but is never even threaded into `InfaktInvoicingAdapter`'s constructor. This is a same-shape, same-scope fix — CORE remains untouched.

---

## 4. External / Domain Research

### Internal Patterns
- `InfaktConnectionConfig.baseUrl` (`libs/integrations/infakt/src/domain/types/infakt-connection.types.ts`) is the existing precedent for a per-connection non-secret config knob: optional field → validated by `InfaktConnectionConfigShapeValidatorAdapter` → read in `InfaktAdapterFactory` → (today, incompletely) reaches the adapter only for `baseUrl`, never threaded further for other fields since none existed until now.
- `as const` union pattern used throughout `libs/core/src/invoicing/domain/types/invoicing.types.ts` (`DocumentTypeValues`, `InvoiceStatusValues`, etc.) — followed here for `InfaktPaymentMethodValues`.

---

## 5. Questions & Assumptions

### Assumptions
- Default value stays `'cash'` when `defaultPaymentMethod` is absent — matches the safer of the two current hardcoded values and requires no operator action for existing connections.
- No live check of Infakt's bank-account configuration is attempted; the prerequisite is surfaced via code comment + this plan, and via the (out-of-scope) FE field description whenever that follow-up ships.

### Documentation Gaps
- None blocking — Option 2 vs Option 1 is resolved above with concrete evidence from the codebase (no order-level signal exists).

---

## 6. Proposed Implementation Plan

### Phase 1: Config type + validation
**Goal**: Make `defaultPaymentMethod` a first-class, validated per-connection setting.

**Steps**:
1. **Add `InfaktPaymentMethodValues`/`InfaktPaymentMethod` + extend `InfaktConnectionConfig`**
   - **File**: `libs/integrations/infakt/src/domain/types/infakt-connection.types.ts`
   - **Action**: Add `export const InfaktPaymentMethodValues = ['cash', 'transfer'] as const;` + derived type; add `defaultPaymentMethod?: InfaktPaymentMethod` to `InfaktConnectionConfig` with a doc comment on the `'transfer'` prerequisite.
   - **Acceptance**: Type compiles; doc comment present.

2. **Validate the new field**
   - **File**: `libs/integrations/infakt/src/infrastructure/adapters/infakt-connection-config-shape-validator.adapter.ts`
   - **Action**: When `config.defaultPaymentMethod` is present, reject unless it's one of `InfaktPaymentMethodValues`.
   - **Acceptance**: Unit test covers valid (`'cash'`, `'transfer'`, absent) and invalid (`'card'`, `123`) inputs.

### Phase 2: Thread config into the adapter
**Goal**: Both `issueInvoice` and `issueCorrection` derive `payment_method` from the same per-connection setting.

**Steps**:
1. **Factory passes config through**
   - **File**: `libs/integrations/infakt/src/application/infakt-adapter.factory.ts`
   - **Action**: Pass `config` (already resolved for `baseUrl`) as a 4th constructor arg to `InfaktInvoicingAdapter`.
   - **Acceptance**: Existing `baseUrl` tests still pass; new/updated test asserts `defaultPaymentMethod` reaches the adapter.

2. **Adapter constructor + both payloads**
   - **File**: `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`
   - **Action**: Add optional 4th constructor param `config: InfaktConnectionConfig = {}`; compute `private readonly paymentMethod = config.defaultPaymentMethod ?? 'cash';`; replace both hardcoded `payment_method: 'transfer'` / `'cash'` literals with `payment_method: this.paymentMethod`. Update the surrounding comments to explain the config-driven default + the `'transfer'` prerequisite (replacing the now-stale "OL has no way to configure" comment, since this PR is exactly that configuration mechanism).
   - **Acceptance**: `issueInvoice` and `issueCorrection` always agree; default (no config) behaves exactly as `issueCorrection` does today.

### Implementation Details

**Configuration Changes**: none (no env vars) — purely a per-connection `config` JSON field, consistent with `baseUrl`.

**Database Migrations**: none — `config` is an existing untyped JSON column.

**Error Handling**: `InvalidConnectionConfigException` (already used by the validator) covers the new invalid-value case; no new exception type needed.

---

## 7. Alternatives Considered

### Alternative 1: Core contract field (`IssueInvoiceCommand.paymentMethod`)
- **Description**: Add a neutral `paymentMethod` to `IssueInvoiceCommand`/`IssueCorrectionCommand`, populated from an order-level signal, mapped per-adapter.
- **Why Rejected**: No order-level payment-*method* signal exists anywhere in `libs/core/src/orders` today (`Order.paymentStatus` is a payment-*state* axis, not method) — the field would have nothing real to populate from. It would also force KSeF and Subiekt to add unused mapping code for a concept neither currently needs, widening the core contract surface for a single consumer.
- **Trade-offs**: More "architecturally pure" in the abstract, but speculative given the actual data available; better revisited once an order source can supply a real payment-method signal.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE changes; all changes confined to `libs/integrations/infakt/`, mirroring the `baseUrl` precedent exactly.

### Naming Conventions
- ✅ `InfaktPaymentMethodValues` / `InfaktPaymentMethod` follow the `as const` + derived-union pattern from `engineering-standards.md`.

### Risks
- **Silent fiscal mislabeling if an operator picks `'transfer'` without a configured bank account**: mitigated by defaulting to `'cash'` and documenting the prerequisite; the existing `InfaktApiError`/`failureMode` propagation surfaces the 422 loudly rather than silently succeeding with wrong data.

### Backward Compatibility
- ✅ Existing connections with no `defaultPaymentMethod` behave identically to `issueCorrection`'s current hardcoded `'cash'` (the safe value) — `issueInvoice`'s behavior changes from `'transfer'` to `'cash'` by default, which is the *fix*, not a regression (transfer already 422s for accounts without a bank account configured, per the issue and prior live verification).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `infakt-connection-config-shape-validator.adapter.spec.ts`: valid/invalid `defaultPaymentMethod` values.
- `infakt-invoicing.adapter.spec.ts`: default (`'cash'`) and configured (`'transfer'`) behavior for both `issueInvoice` and `issueCorrection`, asserting they agree.
- `infakt-adapter.factory.spec.ts`: `defaultPaymentMethod` from `connection.config` reaches the constructed adapter.

### Acceptance Criteria
- [x] Decision documented: per-connection config (Option 2), not a core contract field — see § Alternatives Considered.
- [x] `issueInvoice` and `issueCorrection` send a consistent, config-derived `payment_method`.
- [x] The `'transfer'` bank-account prerequisite is documented (code comments); it is an explicit opt-in the operator makes, not enforced by an OL-side check (none is available).
- [x] Tests added.
- [x] No CORE ↔ Integration boundary violations.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors `baseUrl`
- [x] Idempotency considered — unaffected (unrelated to `external_id`)
- [x] Error handling comprehensive — `InvalidConnectionConfigException` reused
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
