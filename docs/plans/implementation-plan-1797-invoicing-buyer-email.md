# Implementation Plan: Carry Buyer E-mail Into the Invoicing Domain (Fix Infakt "Send by Email" 422)

**Date**: 2026-07-23
**Status**: Draft
**Estimated Effort**: 4–6 hours
**Issue**: [#1797](https://github.com/openlinker-project/openlinker/issues/1797)

---

## 1. Task Summary

**Objective**: Thread the buyer's e-mail address — already present on `Order.customerEmail` — through the invoicing domain (`BuyerProfile`) and into `InfaktInvoicingAdapter.upsertCustomer()`'s `clients.json` payload, so Infakt clients are created *with* an e-mail and `POST /invoices/:invoiceId/send-email` stops 422ing.

**Context**: Every invoice issued through Infakt today creates a client with no e-mail on file, because `BuyerProfile` (the shared neutral buyer shape used by every invoicing provider adapter, per ADR-026) has no `email` field at all. Confirmed empirically (see issue #1797): a throwaway repro test showed the real `clients.json` POST body omits `email` entirely. Infakt then rejects `deliver_via_email.json` with `422 — "adres e-mail Klienta jest nieznany"` (client's e-mail unknown), so the "Send by email" button is broken for 100% of Infakt invoices.

**Classification**: CORE (domain entity + application mapper + sync job payload contract) + Integration (Infakt adapter).

---

## 2. Scope & Non-Goals

### In Scope
- Add an optional `email: string | null` field to `BuyerProfile` (domain entity).
- Populate it from `Order.customerEmail` in the order→invoice command mapper (covers all **synchronous** issuance paths: manual issue, bulk-issue, retry, correction's original-invoice reissue — all call the mapper directly).
- Carry it through the **asynchronous auto-issue path**: `AutoIssueTriggerService` flattens `IssueInvoiceCommand.buyer` into a plain, jsonb-serializable sync-job payload (`InvoicingIssueBuyerV1`), and `InvoicingIssueHandler` (worker) reconstructs `BuyerProfile` from that plain shape before calling `issueInvoice`. Both the flatten and the reconstruction need the new field or it silently drops on this path only.
- Send `email` in `InfaktInvoicingAdapter.upsertCustomer()`'s `clients.json` payload on client **creation**.
- Add/extend unit tests for every touched file.
- Extend `libs/integrations/infakt/scripts/poc-sandbox-test.ts` to exercise `sendByEmail` against the real sandbox (currently uncovered by the POC script — the only real-API check available for this feature).

### Out of Scope
- Updating the existing-client-found-by-NIP branch (`upsertCustomer` lines 352-358) to `PUT`-backfill an e-mail onto a pre-existing e-mail-less Infakt client. This is a separate, smaller follow-up — verify against the sandbox first; not required to fix the reported bug (new clients created going forward will have the e-mail).
- `IssuedSnapshotBuyer` / `buildSnapshotFromRecord` (`apps/api/src/invoicing/http/invoicing.controller.ts:1160-1176`) and `IssuedDocumentBuyer` — these rebuild a `BuyerProfile` only for `IssueCorrectionCommand.originalDocument`, which never calls `upsertCustomer` or `sendByEmail`. Traced and confirmed not on the affected path; left untouched.
- `Subiekt`'s `upsertCustomer()` (`libs/integrations/subiekt/...`) — also takes a `BuyerProfile` and could benefit from `email` later, but Subiekt has no reported bug and is not part of this issue. The new field is available to it for free; wiring it in is a follow-up if Subiekt ever needs e-mail delivery.
- Any UI change — the "Send by email" button and its request already exist and are correct; only the payload the *client-creation* call sends is wrong.
- A database migration — no schema change; `email` lives only in-memory (mapper output) and in a jsonb sync-job payload column that already stores arbitrary buyer fields.

### Constraints
- `BuyerProfile` is a plain domain entity per [ADR-011](../architecture/adrs/011-domain-entity-behavior.md) — anemic, readonly constructor fields only, no added behavior.
- Must not break any of the 5 existing `new BuyerProfile(...)` call sites (mapper, worker handler, controller correction-snapshot rebuild, POC script, and the two test spec helper functions) — the new field must be **optional / defaulted** so untouched call sites keep compiling.
- `InvoicingIssuePayloadV1` is a versioned, schema-pinned contract (`schemaVersion: 1`) already amended once additively (`saleDate`, per its own doc comment: "Optional additive field - no schemaVersion bump"). The new `email` field on `InvocingIssueBuyerV1` follows the same precedent — no version bump.
- No PII policy change — `Order.customerEmail` is already an existing, sanctioned field (#948); this only threads it one layer further into an already-PII-carrying payload (the same job payload's doc comment already flags `buyer`/`lines` as containing real PII that must never be logged).

---

## 3. Architecture Mapping

**Target Layer**: Domain (`libs/core/src/invoicing/domain/entities/`), Application (`libs/core/src/invoicing/application/mappers/`, `libs/core/src/invoicing/application/services/`), Shared sync-contract types (`libs/core/src/sync/domain/types/`), Infrastructure/Adapter (`libs/integrations/infakt/src/infrastructure/adapters/`).

**Capabilities Involved**:
- `InvoicingPort.upsertCustomer` (base port method, unchanged signature — only the Infakt adapter's payload construction changes).
- `InvoiceEmailSender.sendByEmail` (unchanged — this issue fixes the *upstream* cause of its 422, not the method itself).

**Existing Services Reused**:
- `order-to-issue-invoice-command.mapper.ts::toIssueInvoiceCommand` / `buildBuyerProfile` — extended, not replaced.
- `AutoIssueTriggerService` — extended (one more field in the flatten).
- `InvoicingIssueHandler` (worker) — extended (one more field in the reconstruction).
- `InfaktInvoicingAdapter.upsertCustomer` — extended (one more key in the `clients.json` payload).

**New Components Required**: None. This is a field-level extension to four existing files plus their tests — no new entities, ports, services, or adapters.

**Core vs Integration Justification**: The `email` field belongs on `BuyerProfile` in **CORE**, not as an Infakt-only workaround, because `BuyerProfile` is the shared neutral buyer shape every invoicing provider adapter receives (ADR-026, country-agnostic design) — any other provider adapter implementing e-mail delivery would need the identical seam. Only the *payload-building* change (what JSON key to send, when) is Infakt-specific and belongs in the Infakt adapter. This mirrors the existing precedent of `taxId: TaxIdentifier | null` — a neutral, optional field on `BuyerProfile` that individual adapters choose whether/how to use.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure), [Architecture Overview §14 Invoicing](../architecture-overview.md#14-invoicing).

---

## 4. External / Domain Research

### External System (Infakt)
- **Endpoint affected**: `POST clients.json` (client creation) — confirmed via `InfaktClient` response type (`libs/integrations/infakt/src/domain/types/infakt.types.ts:102-112`) that Infakt's client resource already models `email: string | null`; the provider API supports it, OL just never sends it.
- **Endpoint whose failure this fixes**: `POST invoices/{uuid}/deliver_via_email.json` — requires a stored client e-mail, no recipient-override parameter (adapter doc comment, `infakt-invoicing.adapter.ts:792-802`).
- **No rate-limit or retry changes** — this is a payload-completeness fix, not a transport concern.
- **Verification channel**: `libs/integrations/infakt/scripts/poc-sandbox-test.ts` run against `https://api.sandbox-infakt.pl/api/v3` with `INFAKT_SANDBOX_API_KEY`. Currently exercises upsertCustomer → issueInvoice → getInvoice → getClearanceStatus → sendToKsef, but not `sendByEmail` — this plan extends it.

### Internal Patterns
- **Similar precedent**: `BuyerProfile.taxId: TaxIdentifier | null` — an optional, scheme-tagged, nullable field already on the entity, with the exact same "caller doesn't have to supply it" shape the plan proposes for `email`. `email` follows the identical pattern.
- **Reusable components**: No new abstractions — `order.customerEmail` (already exists, #948), the mapper, the worker handler, and the adapter's existing payload-building code are all reused verbatim, just extended by one field each.
- **Existing additive-payload precedent**: `saleDate` on `InvoicingIssuePayloadV1` — added without a `schemaVersion` bump, with an inline comment explaining why. The `email` addition to `InvocingIssueBuyerV1` follows this exact precedent.

---

## 5. Questions & Assumptions

### Open Questions
- Should the Infakt "found existing client by NIP" branch (`upsertCustomer`, lines 352-358) `PUT`-backfill an e-mail onto a client that already exists in Infakt without one? Left open — resolve empirically against the sandbox during implementation; **not** required by the acceptance criteria below (out of scope, see §2).

### Assumptions
- `email` is **optional and nullable** on `BuyerProfile` — an order with no captured buyer e-mail (source platform didn't expose one) must continue to issue invoices successfully; only `sendByEmail` for that invoice keeps 422ing with the same clear provider-supplied reason, which is correct, expected behavior, not a regression to fix.
- The `email` field is added as the **5th, defaulted constructor parameter** (`email: string | null = null`) on `BuyerProfile`, not inserted earlier in the parameter list — this keeps every existing 4-argument call site (worker handler, POC script, both spec files, controller correction-snapshot rebuild) compiling unchanged, and only the mapper and the async-path flatten/reconstruction need to actually pass a 5th argument.
- No PII/GDPR policy change needed — `Order.customerEmail` is an existing, already-sanctioned field (#948); this only threads an existing value one layer further into an already-PII-carrying payload.
- No ADR is required for this change (see [ADR README §When to write an ADR](../architecture/adrs/README.md)) — it's a routine additive field on an existing entity following an established pattern (`taxId`), with no rejected alternative design, no cross-package contract break, and no multi-context coordination beyond the four files touched. Assessed and explicitly declined.

### Documentation Gaps
- None found — ADR-026 (country-agnostic invoicing) and the existing `BuyerProfile`/`taxId` precedent give clear guidance for how to add this field.

---

## 6. Proposed Implementation Plan

### Phase 1: Domain — `BuyerProfile.email`

**Goal**: Give the neutral buyer shape a seam for an e-mail address.

**Steps**:
1. **Add `email` field to `BuyerProfile`**
   - **File**: `libs/core/src/invoicing/domain/entities/buyer-profile.entity.ts`
   - **Action**: Add a 5th constructor parameter `public readonly email: string | null = null` after `type`. Update the file's header comment if it documents the constructor shape.
   - **Acceptance**: `new BuyerProfile('Jan', null, address, 'private')` still compiles (email defaults to `null`); `new BuyerProfile('Jan', null, address, 'private', 'jan@example.com')` sets `email`.
   - **Dependencies**: None.

2. **Extend `BuyerProfile` unit tests**
   - **File**: `libs/core/src/invoicing/domain/entities/buyer-profile.entity.spec.ts`
   - **Action**: Add a test asserting `email` defaults to `null` when omitted, and a test asserting the 5th argument is assigned verbatim when passed.
   - **Acceptance**: `pnpm --filter @openlinker/core test buyer-profile.entity.spec.ts` passes.
   - **Dependencies**: Step 1.

### Phase 2: Application — synchronous issuance path (mapper)

**Goal**: Every synchronous `toIssueInvoiceCommand` call (manual issue, bulk-issue, retry, correction reissue) picks up the order's buyer e-mail automatically.

**Steps**:
3. **Pass `order.customerEmail` into `BuyerProfile` in the mapper**
   - **File**: `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts`
   - **Action**: In `buildBuyerProfile` (currently lines 139-151), change the return to `new BuyerProfile(name, buyerTaxId, address, type, order.customerEmail ?? null)`.
   - **Acceptance**: An `Order` with `customerEmail: 'buyer@example.com'` produces a `BuyerProfile` whose `.email === 'buyer@example.com'`; an `Order` with no `customerEmail` produces `.email === null` (no throw — `InvalidBuyerProfileError` still fires only for the existing missing-address/name cases).
   - **Dependencies**: Phase 1.

4. **Extend the mapper's unit tests**
   - **File**: `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.spec.ts`
   - **Action**: Add a test asserting `order.customerEmail` flows into `command.buyer.email`; add a test asserting an order with no `customerEmail` yields `command.buyer.email === null` without throwing.
   - **Acceptance**: `pnpm --filter @openlinker/core test order-to-issue-invoice-command.mapper.spec.ts` passes.
   - **Dependencies**: Step 3.

### Phase 3: Application/Sync — asynchronous auto-issue path

**Goal**: The queued/async auto-issue path (`AutoIssueTriggerService` → sync job → `InvoicingIssueHandler`) doesn't silently drop the e-mail during the jsonb round-trip.

**Steps**:
5. **Add `email` to the plain, serializable buyer shape**
   - **File**: `libs/core/src/sync/domain/types/invoicing-job-payloads.types.ts`
   - **Action**: Add `email: string | null;` to `InvoicingIssueBuyerV1`. Follow the file's own additive-field precedent (see the `saleDate` comment) — no `schemaVersion` bump; add a one-line comment noting it's additive and a v1 consumer written before this field existed already tolerates an extra jsonb key.
   - **Acceptance**: Type-checks; no existing payload-shape test breaks.
   - **Dependencies**: Phase 1 (uses `BuyerProfile.email`'s type).

6. **Flatten `email` into the job payload**
   - **File**: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts`
   - **Action**: In the payload-composing block (currently lines 266-271), add `email: command.buyer.email` to the flattened `buyer` object.
   - **Acceptance**: The composed `InvoicingIssuePayloadV1.buyer.email` matches `command.buyer.email` for an order with a captured customer e-mail.
   - **Dependencies**: Step 5, Phase 2 (step 3 — `command.buyer` already carries `email` by the time this runs, since `AutoIssueTriggerService` also calls `toIssueInvoiceCommand`).

7. **Reconstruct `email` in the worker handler**
   - **File**: `apps/worker/src/sync/handlers/invoicing-issue.handler.ts`
   - **Action**: In `toCommand` (currently lines 169-176), pass `payload.buyer.email` as the 5th argument to `new BuyerProfile(...)`. Also check the deep-validation block (the `fail('buyer.taxId.value')`-style guards, around lines ~150-160) — add a lenient check that `payload.buyer.email` is `string | null` if present, matching the existing per-field validation style, WITHOUT requiring it (backward-compatible with any already-queued v1 jobs from before this field existed, which won't have the key at all — `payload.buyer.email` will be `undefined` there; normalize `undefined` to `null` when reconstructing).
   - **Acceptance**: A validated `InvocingIssuePayloadV1` with `buyer.email` set reconstructs a `BuyerProfile` whose `.email` matches; a payload from before this field existed (no `email` key) reconstructs `.email === null` without failing validation.
   - **Dependencies**: Step 5.

8. **Extend worker-handler and auto-issue-trigger unit tests**
   - **Files**:
     - `apps/worker/src/sync/handlers/__tests__/invoicing-issue.handler.spec.ts` — **exists** (correction: an earlier pass of this plan mis-checked the sibling-flat convention and missed this handler's own `__tests__/` subdirectory; verified present with 191 lines of existing coverage). Extend it, following its own `makePayload(overrides)` helper pattern.
     - `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts` — **exists** (verified); extend it.
   - **Action**: Assert the round-trip: a command with `buyer.email` set survives flatten → (simulated jsonb round-trip, e.g. `JSON.parse(JSON.stringify(payload))`) → reconstruct, ending with the same `email` value. Assert a pre-existing-field-shape payload (no `email` key) reconstructs to `email: null`.
   - **Acceptance**: Both spec files pass.
   - **Dependencies**: Steps 6, 7.

### Phase 4: Infrastructure — Infakt adapter payload

**Goal**: `upsertCustomer()` actually sends the e-mail to Infakt on client creation.

**Steps**:
9. **Include `email` in the `clients.json` create payload**
   - **File**: `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`
   - **Action**: In `upsertCustomer` (currently lines 364-373), add `email: buyer.email ?? undefined` to the `payload.client` object (matching the existing `nip: nip ?? undefined` pattern already in the same object literal — `undefined` keys are dropped by `JSON.stringify`, so a `null` `email` produces the same "field omitted" wire shape Infakt already tolerates today).
   - **Acceptance**: Confirmed via unit test (below) that the `client` object includes `email: 'buyer@example.com'` when the buyer has one, and omits the key when the buyer's `email` is `null`.
   - **Dependencies**: Phase 1.

10. **Extend `infakt-invoicing.adapter.spec.ts`'s `upsertCustomer` tests**
    - **File**: `libs/integrations/infakt/src/infrastructure/adapters/__tests__/infakt-invoicing.adapter.spec.ts`
    - **Action**: Add a case to the existing `describe('upsertCustomer', ...)` block: build a `buyer` with an `email` set (extend the local `buyer()` test helper to accept an `email` override, defaulting to `null` to keep existing calls unchanged) and assert the `POST clients.json` body's `client.email` equals it. Add a second case with `email: null` and assert the `client` object has no `email` key (`expect(Object.keys(createCall.body.client)).not.toContain('email')` — this is the exact repro assertion used to confirm the bug in issue #1797, now flipped to prove the fix).
    - **Acceptance**: `pnpm --filter @openlinker/integrations-infakt test infakt-invoicing.adapter.spec.ts` passes.
    - **Dependencies**: Step 9.

### Phase 5: Real-provider verification (sandbox)

**Goal**: Prove the fix end-to-end against the actual Infakt API, not just mocks — this path has zero real-API coverage today.

**Steps**:
11. **Extend the sandbox POC script to exercise `sendByEmail`**
    - **File**: `libs/integrations/infakt/scripts/poc-sandbox-test.ts`
    - **Action**: Add an `email` to the script's `testBuyer` (currently lines 66-71, no 5th arg). After the existing `issueInvoice` step, add a call to `adapter.sendByEmail({ externalInvoiceId: <issued uuid>, locale: undefined, sendCopy: undefined })` and log the result. Use a real, disposable test-inbox address the operator controls (never a fabricated third-party address) — document this requirement in a comment next to the new call.
    - **Acceptance**: Manual run instructions documented in the script's header comment (or immediately above the new call) so a future maintainer can re-run it.
    - **Dependencies**: Phase 4.
12. **Manual verification run** (not automatable in CI — requires `INFAKT_SANDBOX_API_KEY`)
    - **Action**: Run `INFAKT_SANDBOX_API_KEY=<key> pnpm --filter @openlinker/integrations-infakt poc:sandbox` locally. Confirm: (a) the created sandbox client has the e-mail set (inspect the Infakt sandbox dashboard or the script's logged response), (b) `sendByEmail` returns `{ delivered: true, recipient: null }` instead of throwing a 422.
    - **Acceptance**: Documented as done in the PR description with the observed script output (redacted of any real secret/API key).
    - **Dependencies**: Step 11.

---

## Implementation Details

**New Components**: None — every change is an additive field or payload-key extension to existing files.

**Configuration Changes**: None.

**Database Migrations**: None — no ORM entity changes; `email` lives in-memory (mapper/adapter) and inside the existing jsonb `invoicing.issue` sync-job payload column, which already stores arbitrary buyer fields with no per-field schema.

**Events**: None emitted or consumed by this change.

**Error Handling**: No new exception types. `InvalidBuyerProfileError` (thrown by the mapper for missing name/address) is unaffected — an order missing only `customerEmail` must not throw; it should simply carry `email: null`.

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure), [Engineering Standards - Type Definitions in Separate Files](../engineering-standards.md#type-definitions-in-separate-files) (the new field lives directly on `BuyerProfile`/`InvoicingIssueBuyerV1`, matching how `taxId` already does — no separate `*.types.ts` extraction needed for a single primitive field on an existing type).

---

## 7. Alternatives Considered

### Alternative 1: Fix only inside `InfaktInvoicingAdapter`, deriving e-mail from somewhere adapter-local
- **Description**: Have the Infakt adapter itself look up the buyer's e-mail some other way (e.g. from `IdentifierMappingService` context, or a side-channel lookup) instead of extending `BuyerProfile`.
- **Why Rejected**: There is no other channel — the e-mail only exists on `Order.customerEmail`, which the adapter never sees (it only receives `IssueInvoiceCommand`/`BuyerProfile`). Inventing an adapter-side lookup would duplicate or bypass the mapper's already-correct order→command composition, and would leave every *other* invoicing provider (Subiekt, future ones) without the same fix.
- **Trade-offs**: Marginally larger diff (4 files instead of 1) but the correct architectural placement per ADR-026's shared-neutral-model design; the extra files are one-line-per-file additions.

### Alternative 2: Bump `InvoicingIssuePayloadV1` to `schemaVersion: 2`
- **Description**: Treat the new `buyer.email` field as a breaking schema change requiring a version bump and handler branching for v1 vs v2 payloads.
- **Why Rejected**: The file's own doc comment already establishes the additive-field precedent (`saleDate`) — a v1 consumer that doesn't know about `email` still works correctly by treating it as absent/`null`. A version bump is reserved for genuinely breaking changes (field removal/retyping), not an optional new key.
- **Trade-offs**: None meaningful — the additive path is strictly simpler and follows established convention.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ `BuyerProfile` stays anemic (readonly constructor field only, no new behavior) — complies with [ADR-011](../architecture/adrs/011-domain-entity-behavior.md).
- ✅ No CORE ↔ Integration boundary violation — `email` is a neutral field on a CORE entity; the Infakt adapter only reads it and shapes its own wire payload.
- **Reference**: [Architecture Overview](../architecture-overview.md).

### Naming Conventions
- ✅ `email: string | null` matches the existing `taxId: TaxIdentifier | null` nullable-optional convention on the same entity.
- **Reference**: [Engineering Standards - Naming Conventions](../engineering-standards.md#naming-conventions).

### Existing Patterns
- ✅ Additive-field-on-versioned-payload pattern already established by `saleDate` on `InvoicingIssuePayloadV1` — followed verbatim for `email` on `InvocingIssueBuyerV1`.
- ✅ `undefined`-drops-the-JSON-key pattern already used for `nip: nip ?? undefined` in the same Infakt payload object — followed verbatim for `email ?? undefined`.

### Risks
- **Silent field-drop on the async path if Phase 3 is skipped**: if only Phases 1/2/4 ship, the *synchronous* issuance paths (manual issue, bulk-issue, retry, correction reissue) get the fix, but the *auto-issue* (async, queued) path would keep silently dropping `email` at the jsonb flatten step, reproducing the exact same bug for a subset of invoices with no obvious symptom difference. Mitigation: Phase 3 is not optional — it's the primary way most production invoices are likely issued (via `AutoIssueTriggerService`, not manual `POST /invoices`).
- **Already-queued jobs from before this change**: any `invoicing.issue` sync job already sitting in the queue (persisted with the old `InvocingIssueBuyerV1` shape, no `email` key) must not fail worker-side deep validation when picked up post-deploy. Mitigation: step 7 explicitly handles `payload.buyer.email === undefined` by normalizing to `null`, not by requiring the key.

### Edge Cases
- **Order with no captured `customerEmail`** (source platform didn't expose one): invoice issuance must still succeed; `email` on `BuyerProfile` is `null`; `sendByEmail` for that invoice keeps failing with Infakt's own clear 422 reason — expected, not a regression.
- **Buyer e-mail changes between order placement and a later retry/correction**: out of scope — `Order.customerEmail` is read at command-composition time exactly as every other buyer field already is; no new staleness risk beyond what already exists for name/address.

### Backward Compatibility
- ✅ No breaking changes. `BuyerProfile`'s new constructor parameter is defaulted; every existing call site (worker handler pre-fix, POC script, both spec helpers, controller correction-snapshot rebuild) keeps compiling without modification (except where this plan explicitly extends them). `InvocingIssueBuyerV1`'s new field is additive per the file's own established convention.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `buyer-profile.entity.spec.ts` — `email` defaults to `null`; `email` is assigned when passed. **File**: `libs/core/src/invoicing/domain/entities/buyer-profile.entity.spec.ts`.
- `order-to-issue-invoice-command.mapper.spec.ts` — `order.customerEmail` flows into `command.buyer.email`; missing `customerEmail` yields `null` without throwing. **File**: `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.spec.ts`.
- `auto-issue-trigger.service.spec.ts` (exists — extend) — flattened payload's `buyer.email` matches the command's. **File**: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.spec.ts`.
- `invoicing-issue.handler.spec.ts` (exists — extend) — reconstructed `BuyerProfile.email` matches the payload's; a payload missing the `email` key (pre-fix shape) reconstructs to `null`. **File**: `apps/worker/src/sync/handlers/__tests__/invoicing-issue.handler.spec.ts`.
- `infakt-invoicing.adapter.spec.ts` — `clients.json` POST body includes `email` when set, omits the key when `null` (the flipped repro assertion from issue #1797). **File**: `libs/integrations/infakt/src/infrastructure/adapters/__tests__/infakt-invoicing.adapter.spec.ts`.

### Integration Tests
- None required — this is pure application/domain logic plus one adapter payload shape; no new HTTP endpoint, DB schema, or cross-service orchestration is introduced. The existing `POST /invoices/:invoiceId/send-email` controller endpoint and its behavior are unchanged.

### Mocking Strategy
- Adapter test continues to use `FakeInfaktHttpClient` (existing pattern) — no real HTTP calls in unit tests.
- Real-provider verification happens exclusively via the Phase 5 sandbox script, run manually (not part of `pnpm test` or CI).

### Acceptance Criteria
- [ ] `BuyerProfile` has an `email: string | null` field (defaulted to `null`), populated from `order.customerEmail` via the mapper.
- [ ] The async auto-issue path (`AutoIssueTriggerService` → job payload → `InvoicingIssueHandler`) preserves `email` through the jsonb round-trip.
- [ ] `InfaktInvoicingAdapter.upsertCustomer()` includes `email` in the `clients.json` payload when the buyer has one, and omits the key when the buyer has none.
- [ ] Manual verification against the real Infakt sandbox (extended `poc-sandbox-test.ts`, `INFAKT_SANDBOX_API_KEY`): a newly-created Infakt client has the e-mail set, and `sendByEmail` returns `{ delivered: true }` instead of a 422.
- [ ] Regression check: an order with no `customerEmail` still issues an invoice successfully (no new exception); `sendByEmail` for that invoice fails with the same clear Infakt-provided reason, not a crash.
- [ ] All new/extended unit tests listed above pass (`pnpm test`).
- [ ] `pnpm lint` and `pnpm type-check` pass with zero errors.
- [ ] No CORE ↔ Integration boundary violations introduced.

**Reference**: [Testing Guide](../testing-guide.md).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions) — mirrors `taxId` on `BuyerProfile` and `saleDate` on `InvoicingIssuePayloadV1`
- [x] Idempotency considered — no change to idempotency keys or dedup logic; e-mail is a passive payload field
- [ ] Event-driven patterns used where applicable — N/A, no events involved
- [ ] Rate limits & retries addressed — N/A, no new external calls or retry logic
- [x] Error handling comprehensive — missing `customerEmail` is a valid, non-throwing state
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards — no new files, only extensions to existing ones
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Architecture Overview §14 Invoicing](../architecture-overview.md#14-invoicing)
- [ADR-026: Country-agnostic invoicing domain](../architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [ADR-011: Domain entity behavior](../architecture/adrs/011-domain-entity-behavior.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Issue #1797](https://github.com/openlinker-project/openlinker/issues/1797)
