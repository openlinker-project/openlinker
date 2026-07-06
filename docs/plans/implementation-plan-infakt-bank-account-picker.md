# Implementation Plan: Infakt Bank-Account Picker for Transfer Invoices

**Date**: 2026-07-02
**Status**: Ready for Review
**Estimated Effort**: 3-4 hours

---

## 1. Task Summary

**Objective**: A direct #1303 follow-up (no separate tracking issue — the harder "live preview during wizard, locked select until a valid key" variant is tracked separately as [#1308](https://github.com/openlinker-project/openlinker/issues/1308) and deferred) — let an operator pick a specific inFakt bank account for `'transfer'` invoices, via a post-create wizard step and the edit-connection `InlineDisclosure` shipped for #1303. When no bank account is configured on the inFakt side, only `'cash'` is offered (no select at all).

**Context**: #1303 added `InfaktConnectionConfig.defaultPaymentMethod`, but `'transfer'` still 422s on inFakt unless a bank account is configured there — OL has no way to see or select one today. Confirmed live: `GET /bank_accounts.json` returns `{ id, account_number, bank_name }`; the VAT invoice schema has top-level `bank_account`/`bank_name`/`swift` fields separate from `payment_method`.

**Classification**: Integration (new `BankAccountsReader` sub-capability + adapter change) + Interface (new controller route) + Frontend.

**Design reference**: [artifact mockup](https://claude.ai/code/artifact/64c52cc2-fb1d-4334-aba4-5f55debcffa2) — approved before implementation. Shows both branches: accounts found (select defaulting to the first, labelled `{bankName} — {accountNumber}`) and no accounts (status pill + explanatory hint, no select). Same block reused inside the existing `InlineDisclosure` on the edit screen, visible only when "Transfer" is selected.

---

## 2. Scope & Non-Goals

### In Scope
- A new `BankAccountsReader` sub-capability on `InvoicingPort` (mirrors `RegulatoryStatusReader`/`CorrectionIssuer`), implemented by `InfaktInvoicingAdapter`.
- A capability-scoped controller route (mirrors `mapping-options.controller.ts`) exposing the live list for an **already-created** connection.
- `InfaktConnectionConfig.bankAccount` — a snapshot `{ id, accountNumber, bankName }` chosen at selection time.
- `InfaktInvoicingAdapter.issueInvoice`/`issueCorrection` attach `bank_account`/`bank_name` when `paymentMethod === 'transfer'` and a `bankAccount` is configured.
- Wizard post-create step (`infakt-setup-form.tsx`) and the `InlineDisclosure` in `infakt-structured-section.tsx` (both from #1303) reuse the same live-fetched picker.
- Empty-list handling: no select rendered, "Cash" is the only option, with a message explaining why.

### Out of Scope
- A live, pre-save preview using an unsaved API key (explicitly rejected on #1303's discussion — the connection must exist first, mirroring "Test connection").
- Live re-validation of a previously-selected bank account at invoice-issuance time (the snapshot can go stale if the operator edits/deletes the account directly in inFakt; accepted risk, see § Questions & Assumptions).
- Any other Infakt payment method (card, etc.).

### Constraints
- Must not add a new `HostServices` registry — `libs/plugin-sdk/src/host-services.ts` explicitly says to "open a follow-up issue rather than silently expand the contract." The `DestinationOptionsReader`/`SourceOptionsReader` precedent in `libs/core/src/orders` proves this doesn't need one: option-discovery is an ordinary capability resolved via `IIntegrationsService.getCapabilityAdapter`, not a host-level registry.

---

## 3. Architecture Mapping

**Target Layer**: CORE (new capability interface, neutral) / Integration (Infakt adapter) / Interface (new controller route) / Frontend.

**Capabilities Involved**:
- New: `BankAccountsReader` (sub-capability of `InvoicingPort`, `libs/core/src/invoicing/domain/ports/capabilities/`).
- Existing: `IIntegrationsService.getCapabilityAdapter<InvoicingPort>(connectionId, 'Invoicing')` (already used elsewhere, e.g. `apps/api/src/invoicing/`).

**Existing Services Reused**:
- `IIntegrationsService` capability resolution (no change needed — `Invoicing` capability already resolves to `InfaktInvoicingAdapter`).
- `mapping-options.controller.ts`'s pattern: resolve adapter → narrow with `is{Capability}` guard → `501` if unsupported.
- `useCreateConnectionMutation`/`useUpdateConnectionMutation` (FE) — no new mutation hook needed, `PATCH /connections/:id` already accepts `config`.

**New Components Required**:
- `libs/core/src/invoicing/domain/ports/capabilities/bank-accounts-reader.capability.ts` — `BankAccountsReader` interface + `isBankAccountsReader` guard + neutral `InvoicingBankAccount` type (co-located per the `regulatory-status-reader.capability.ts` precedent, or in `invoicing.types.ts` if reused elsewhere).
- `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`: `listBankAccounts()` method + `implements BankAccountsReader`; payload changes in `issueInvoice`/`issueCorrection`.
- `libs/integrations/infakt/src/domain/types/infakt.types.ts` (or a new `infakt-bank-account.types.ts`): wire-shape type for `GET /bank_accounts.json` (`{ id, account_number, bank_name }`).
- `libs/integrations/infakt/src/domain/types/infakt-connection.types.ts`: `InfaktConnectionConfig.bankAccount?: { id: number; accountNumber: string; bankName: string }`.
- `apps/api/src/invoicing/http/bank-accounts.controller.ts` (or extend an existing invoicing controller — check `apps/api/src/invoicing/http/` for the right home) — `GET /connections/:id/bank-accounts` route, capability-scoped, `Roles('admin')`.
- `apps/api/src/invoicing/http/dto/bank-account-response.dto.ts`.
- FE: `apps/web/src/features/connections/api/bank-accounts.api.ts` (or extend `connections.api.ts`) + a query hook `useBankAccountsQuery(connectionId)`.
- FE: wizard post-create step in `infakt-setup-form.tsx` (mirrors the existing "Test connection" step at lines ~160-183).
- FE: extend `infakt-structured-section.tsx`'s existing `InlineDisclosure` panel with the live-fetched select (replacing the static `<option value="cash">`/`<option value="transfer">` list with a conditional: fetched accounts present → select with account choices + Cash; absent → static text, no select).

**Core vs Integration Justification**: `BankAccountsReader` is a genuinely neutral capability shape (`{id, accountNumber, bankName}` — no PL-specific vocabulary), following the same litmus `RegulatoryStatusReader` documents ("no nip/ksef/vat/jpk/faktura here"). It lives in CORE because it's a general "does this invoicing provider expose payable bank accounts" question any future provider could answer; the Infakt-specific wire mapping (`account_number` → `accountNumber` snake→camel, `GET /bank_accounts.json` endpoint shape) stays entirely inside the adapter.

---

## 4. External / Domain Research

### External System (inFakt)
- **Endpoint**: `GET /bank_accounts.json` (via existing `IInfaktHttpClient.get`), same auth header (`X-inFakt-ApiKey`) as every other call.
- **Response shape** (confirmed live via `infakt_meta_examples("list_bank_accounts")` and a direct sandbox call): paginated `{ items: [{ id, account_number, bank_name, ... }], pagination: {...} }`. Current sandbox account returns 0 items.
- **Invoice schema** (`infakt_meta_schema("vat_invoice")`): top-level `bank_account: string`, `bank_name: string`, `swift: string`, separate from `payment_method: string`.
- **No pagination handling needed for v1** — default page size (10) is enough for realistic bank-account counts; note this as a documented limitation, not a blocker.

### Internal Patterns
- **Sub-capability pattern**: `libs/core/src/invoicing/domain/ports/capabilities/regulatory-status-reader.capability.ts` — interface + co-located `is*` guard, single method, neutral vocabulary, JSDoc explaining which providers implement it.
- **Capability-scoped controller route**: `apps/api/src/mappings/http/mapping-options.controller.ts` — resolve via `IIntegrationsService.getCapabilityAdapter`, narrow with the guard, `NotImplementedException` (501) when absent.
- **Post-create wizard step**: `apps/web/src/features/connections/components/infakt-setup-form.tsx` lines ~160-183 — the existing "Test connection" affordance that only renders once `createdConnectionId` is set. The bank-account step follows the same shape (own local state, own mutation/query call, rendered in the same conditional block).

---

## 5. Questions & Assumptions

### Assumptions
- Storing a **snapshot** (`{id, accountNumber, bankName}`) rather than re-fetching by `id` at invoice-issuance time is the right tradeoff — confirmed acceptable with the user (bank account details rarely change; avoids a live call + failure mode on every invoice).
- The wizard step is skippable — an operator who doesn't interact with it keeps the default (`'cash'`, no `bankAccount`), consistent with #1303's existing default.
- `GET /bank_accounts.json` failing (network/auth error) during the wizard step should not block connection creation — the step degrades to "Cash only" with an inline error, since the connection already exists by the time this step renders.

### Documentation Gaps
- None — the `DestinationOptionsReader`/`SourceOptionsReader` precedent and `mapping-options.controller.ts` fully specify the pattern to follow.

---

## 6. Proposed Implementation Plan

### Phase 1: CORE capability
1. **`BankAccountsReader` capability**
   - **File**: `libs/core/src/invoicing/domain/ports/capabilities/bank-accounts-reader.capability.ts`
   - **Action**: Define `InvoicingBankAccount { id: string; accountNumber: string; bankName: string }`, `BankAccountsReader { listBankAccounts(): Promise<InvoicingBankAccount[]> }`, `isBankAccountsReader(adapter: InvoicingPort): adapter is InvoicingPort & BankAccountsReader`.
   - **Acceptance**: Unit test (`bank-accounts-reader.capability.spec.ts`, mirrors `regulatory-status-reader` sibling specs) covers the guard's true/false branches.

### Phase 2: Infakt adapter
2. **Wire types + `listBankAccounts`**
   - **File**: `libs/integrations/infakt/src/domain/types/infakt.types.ts` (add `InfaktBankAccount { id: number; account_number: string; bank_name: string }` + `InfaktListResponse<InfaktBankAccount>` reuse).
   - **File**: `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts` — add `async listBankAccounts(): Promise<InvoicingBankAccount[]>` calling `this.http.get<InfaktListResponse<InfaktBankAccount>>('bank_accounts.json')`, mapping snake→camel; add `BankAccountsReader` to the `implements` clause.
   - **Acceptance**: Unit test seeds `FakeInfaktHttpClient` with a bank-accounts response and asserts the mapped shape; a 0-item response maps to `[]`.
3. **Config type + payload wiring**
   - **File**: `libs/integrations/infakt/src/domain/types/infakt-connection.types.ts` — add `bankAccount?: { id: number; accountNumber: string; bankName: string }` to `InfaktConnectionConfig`.
   - **File**: `infakt-invoicing.adapter.ts` — constructor stores `this.bankAccount = config.bankAccount`; in `issueInvoice`/`issueCorrection`, when `this.paymentMethod === 'transfer' && this.bankAccount`, add `bank_account: this.bankAccount.accountNumber, bank_name: this.bankAccount.bankName` to the payload.
   - **Acceptance**: Unit tests — transfer + bankAccount configured → payload carries both fields; transfer without bankAccount → payload omits them (existing #1303 behavior unchanged); cash → payload never carries them regardless of `bankAccount`.
4. **Config shape validation** (optional but consistent with #1303's precedent)
   - **File**: `infakt-connection-config-shape-validator.adapter.ts` — validate `bankAccount` shape when present (`id: number`, `accountNumber`/`bankName`: non-empty strings).

### Phase 3: API route
5. **Bank-accounts controller route**
   - **File**: `apps/api/src/invoicing/http/bank-accounts.controller.ts` (new, or check for an existing small invoicing-options controller to extend first — search `apps/api/src/invoicing/http/` before creating).
   - **Action**: `GET /connections/:id/bank-accounts`, `@Roles('admin')`, resolves `IIntegrationsService.getCapabilityAdapter<InvoicingPort>(id, 'Invoicing')`, narrows with `isBankAccountsReader`, returns `501` if absent, else calls `listBankAccounts()` and maps to a response DTO.
   - **File**: `apps/api/src/invoicing/http/dto/bank-account-response.dto.ts`.
   - **Acceptance**: Controller unit test covers: capability-adapter-not-found → propagates existing error handling; adapter without the capability → 501; adapter with the capability → mapped list.

### Phase 4: Frontend
6. **API + query hook**
   - **File**: `apps/web/src/features/connections/api/connections.api.ts` (or a new `bank-accounts.api.ts` beside it) — thin fetch wrapper.
   - **File**: `apps/web/src/features/connections/hooks/use-bank-accounts-query.ts` — `useBankAccountsQuery(connectionId, { enabled })`.
   - **Acceptance**: Mocked-API-client test for the hook (loading/error/data states).
7. **Wizard post-create step**
   - **File**: `apps/web/src/features/connections/components/infakt-setup-form.tsx` — after `createdConnectionId` is set, render a "Choose bank account" block: fetch via the new hook, pre-select the first item, `<Select>` when the list is non-empty, static "Cash only" text + explanation when empty. Persist via `useUpdateConnectionMutation` (`config.bankAccount` + `config.defaultPaymentMethod`).
   - **Acceptance**: Component test — 0 accounts → no select rendered, "Cash" messaging shown; ≥1 accounts → select defaults to the first, selecting + confirming calls the update mutation with the right `config.bankAccount` snapshot.
8. **Edit screen — live-fetched picker inside `InlineDisclosure`**
   - **File**: `apps/web/src/plugins/infakt/components/infakt-structured-section.tsx` — fetch via the same hook; when accounts exist, the expanded panel's payment-method select gains a second, conditional bank-account select (visible only when `'transfer'` is chosen); when the list is empty, the panel shows only the Cash option (no way to pick Transfer) with an explanatory note.
   - **Acceptance**: Component test mirrors the wizard's empty/non-empty split.

### Implementation Details

**New Components**:
- **Domain**: `BankAccountsReader` capability + `InvoicingBankAccount` type (CORE, `libs/core/src/invoicing`).
- **Infrastructure**: `InfaktInvoicingAdapter.listBankAccounts`, wire types, config shape validator addition.
- **Interface**: `apps/api/src/invoicing/http/bank-accounts.controller.ts` + response DTO.
- **Frontend**: API module, query hook, wizard step, structured-section extension.

**Configuration Changes**: none (no env vars).

**Database Migrations**: none — `config` is existing untyped JSON.

**Events**: none.

**Error Handling**: `NotImplementedException` (501) for adapters without the capability (mirrors `mapping-options.controller.ts`); network/auth errors from `listBankAccounts()` propagate as-is (existing `InfaktApiError`/`failureMode` pattern) and the FE step degrades to "Cash only" with an inline alert rather than blocking the wizard.

---

## 7. Alternatives Considered

### Alternative 1: New `HostServices` registry (`CredentialsPreviewRegistryService`)
- **Description**: A generic host-side registry any plugin could register a "preview options with live credentials" implementation against.
- **Why Rejected**: `libs/plugin-sdk/src/host-services.ts` explicitly documents the tradeoff ("weigh 'every plausible future plugin needs this' against keeping the surface lean... open a follow-up issue rather than silently expand the contract") and today only one plugin (Infakt) needs this. The existing `DestinationOptionsReader`/`SourceOptionsReader` sub-capability precedent already solves the same category of problem ("discover a connection's live option list") without a new registry.
- **Trade-offs**: A registry would generalize sooner, but at the cost of adding host-graph surface with a single, speculative consumer — against the codebase's own stated discipline.

### Alternative 2: Live preview with an unsaved API key (pre-connection-creation)
- **Description**: A raw-credentials endpoint the wizard calls before the connection is ever persisted.
- **Why Rejected**: Explicitly discussed and rejected during #1303 follow-up planning — this is exactly what #1308 tracks as future work — no existing pattern accepts raw, unsaved credentials; the post-create step (mirroring "Test connection") is simpler, safer, and consistent with the existing wizard shape.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ CORE gets one new, genuinely neutral capability — no PL-specific vocabulary leaks in.
- ✅ No `HostServices` expansion — reuses the existing capability-resolution mechanism.
- ✅ FE respects the plugin contract — the bank-account picker lives inside the existing `InfaktStructuredSection`/`InfaktSetupForm` plugin components, not the host.

### Risks
- **Stale snapshot**: if the operator deletes/edits the bank account directly in inFakt after selecting it in OL, the invoice will carry outdated `bank_account`/`bank_name`. Documented above as an accepted risk (bank details change rarely); a future "re-sync bank account" affordance is a natural follow-up, not blocking this issue.
- **Pagination**: if an operator has more than the default page size of bank accounts, only the first page shows. Documented as a v1 limitation; add `limit`/pagination handling only if a real user hits it.

### Edge Cases
- 0 bank accounts → no select, "Cash only" messaging (both wizard and edit screen) — explicit acceptance criterion.
- Bank-accounts fetch fails (network/auth) → step degrades to "Cash only" with an inline error, doesn't block the wizard or the edit form.
- Connection has a stale `bankAccount` config referencing an account since deleted in inFakt → out of scope for this issue (no live re-validation); the adapter sends whatever is in the snapshot.

### Backward Compatibility
- ✅ Fully additive — connections with no `config.bankAccount` behave exactly as #1303 shipped them.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `bank-accounts-reader.capability.spec.ts` — guard true/false.
- `infakt-invoicing.adapter.spec.ts` — `listBankAccounts` mapping (incl. empty list); `issueInvoice`/`issueCorrection` payload with/without `bankAccount` × `cash`/`transfer`.
- `bank-accounts.controller.spec.ts` — 501 when unsupported, mapped list when supported.
- FE: `infakt-setup-form.test.tsx`, `infakt-structured-section.test.tsx` — empty vs non-empty bank-account list branches.

### Integration Tests
- Not required for this issue — the existing Infakt integration-test surface is unit-level (`FakeInfaktHttpClient`); no new int-spec unless a maintainer decides the controller route needs Testcontainers coverage.

### Acceptance Criteria
- [ ] `GET /connections/:id/bank-accounts` returns the live list for an Infakt connection, 501 for a non-Infakt connection.
- [ ] Wizard: 0 accounts → "Cash only", ≥1 accounts → select defaulting to the first.
- [ ] Edit screen: same empty/non-empty behavior inside the existing `InlineDisclosure`.
- [ ] `issueInvoice`/`issueCorrection` attach `bank_account`/`bank_name` only when `transfer` + a configured `bankAccount`.
- [ ] Tests added for all of the above.
- [ ] No new `HostServices` registry; no core vocabulary leak (verified via the same neutral-vocabulary litmus `RegulatoryStatusReader` documents).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries — capability is neutral, wire mapping stays in the adapter
- [x] Uses existing patterns — sub-capability + capability-scoped controller route, no new abstractions invented
- [x] Idempotency considered — read-only capability; no idempotency key needed
- [x] Error handling comprehensive — 501 for unsupported, existing `InfaktApiError` propagation for transport failures
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
