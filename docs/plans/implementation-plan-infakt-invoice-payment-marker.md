# Implementation Plan: Outbound Invoice Payment Marking (#1362)

> Revised after TWO rounds of tech-lead + security review (both run as
> subagents each round). Round 1 caught a factual error and naming/type-
> placement issues (fixed). Round 2 verified all round-1 fixes against the
> live tree and found no BLOCKING/IMPORTANT issues - only the two polish
> items folded in below. See "Review corrections" callouts inline.

## 1. Understand the task

**Goal**: Give OpenLinker a way to push a "paid" state to an invoicing provider
(starting with inFakt) when a marketplace/prepaid order is already settled on
OL's side but the provider has no bank statement to auto-match against (e.g.
Allegro/Erli orders - the buyer paid the marketplace, not the seller's bank
account directly). Without this, such invoices sit as `unpaid` in the
provider's own bookkeeping forever.

This is the **outbound** counterpart to #1354 (already shipped, PR #1361),
which consumes inFakt's `invoice_marked_as_paid` webhook and re-reads
authoritative state via `PaymentStatusReader`. #1362 is the reverse
direction: OL → provider.

**Layer**: CORE (new sub-capability) + Integration (inFakt adapter) +
Interface (HTTP endpoint). No FE, no DB migration.

**Non-goals** (explicitly deferred, per issue's "OR" phrasing):
- Automatic order-paid → mark-paid trigger. No such trigger currently exists
  in `orders`/`sync` for any capability; wiring one is a separate, larger
  piece of work. v1 ships a manual/operator-triggered HTTP endpoint only.
- FE "Mark as paid" button - marked optional in the issue; skipped for v1.
- A dedicated async task-status poll for inFakt's `paid.json` task reference.
  See §7 for the honest risk framing of this decision (**corrected** - the
  first draft over-claimed here).

## 2. Feasibility (verified live against inFakt sandbox, 2026-07-08)

`POST /async/invoices/{uuid}/paid.json` with body `{"invoice":{"paid_date":"YYYY-MM-DD"}}`:
- Returns `201` with an async task envelope (`processing_code: 100`, "Zlecenie przyjęte" - i.e. "task accepted", NOT "task completed").
- Immediate re-read of `GET /invoices/{uuid}.json` shows `status: 'paid'` and
  `paid_date` set to the given date - confirmed on two separate sandbox
  invoices, each with a ~2-3s gap between mark and re-read.
- Re-marking an already-paid invoice is safe (still 201, no error) -
  idempotent from OL's perspective. This was tested against real production
  load characteristics of exactly one request each time, on an
  otherwise-idle sandbox - see §7 for why this doesn't fully retire the
  concurrent-double-mark question.
- Invalid uuid → 404 with `{"error": "..."}"` - maps to the adapter's existing
  `InfaktApiError` pattern.
- `left_to_pay`/`paid_price` do not zero out via this call (provider-side
  ledger quirk, not blocking - `toPaymentStatus()` in the adapter already
  reads `status`/`paid_date`, not `left_to_pay`).

## 3. Research - existing patterns to reuse

- **Capability pattern**: `libs/core/src/invoicing/domain/ports/capabilities/invoice-email-sender.capability.ts`
  is a template for the file shape (single-method optional sub-capability,
  co-located `is*` guard, neutral vocabulary per ADR-026). **Correction from
  tech review**: `InvoiceEmailSender` is the *minority* pattern for where its
  command type lives (inline in the capability file). The majority pattern -
  and the one that matters here because it's the capability's own read-side
  sibling - is `PaymentStatusReader` → `PaymentStatusResult`, which lives in
  `domain/types/invoicing.types.ts`. See §4 for the corrected type placement.
- **Adapter pattern**: `InfaktInvoicingAdapter.sendByEmail` (`libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts`)
  - thin `this.http.post(path, payload)` + a log line, with
  `encodeURIComponent` around the caller-supplied id. `markPaid` follows the
  same shape.
- **Controller pattern**: `POST invoices/:invoiceId/send-email` (no
  local-record refresh) and `POST invoices/:invoiceId/resend-to-ksef`
  (persists the returned outcome back onto the record via
  `IInvoiceService.applyRegulatoryClearance`). Our endpoint follows the
  resend-to-ksef shape but refreshes via the **existing** `PaymentStatusRefreshService`
  (#1354) rather than adding a new `IInvoiceService` mutation method - no new
  core service surface needed. **Tech review flagged this trade-off
  explicitly** - see §4 and §7.
- **Manifest check (confirmed, no change needed)**: `infaktAdapterManifest`
  (`libs/integrations/infakt/src/infakt-plugin.ts`) only declares the base
  `'Invoicing'` capability; every prior sub-capability addition
  (`PaymentStatusReader`, `InvoiceEmailSender`, `BankAccountsReader`, …) was
  added without touching the manifest, because sub-capabilities are
  runtime-narrowed via `is*` guards at call sites, not declared statically.
  `markPaid` follows the same convention - **no manifest edit**.

## 4. Design

### CORE - `libs/core/src/invoicing`

**Naming correction (tech review)**: the plan originally named this
`InvoicePaymentMarker`/`isInvoicePaymentMarker`. The plan's own framing calls
this capability "the outbound counterpart to `PaymentStatusReader`" - but
`PaymentStatusReader` carries no `Invoice` prefix, so `InvoicePaymentMarker`
breaks that stated pairing. Renamed to **`PaymentMarker`/`isPaymentMarker`**
for symmetry (mirrors the `RegulatoryStatusReader` ↔ `RegulatoryResubmitter`/
`RegulatoryTransmitter` pairs, none of which are inconsistently prefixed
within a pair).

**Type placement correction (tech review)**: `MarkInvoicePaidCommand` moves
into `domain/types/invoicing.types.ts` alongside its read-side sibling
`PaymentStatusResult`, rather than living inline in the capability file. This
is closer to the engineering-standards.md "types live in separate files"
rule and matches the majority precedent (`RegulatoryResubmitter`,
`RegulatoryStatusReader`, `RegulatoryTransmitter`, `CorrectionIssuer` all do
this; only `InvoiceEmailSender`/`BankAccountsReader` keep types inline).

**Edit**: `domain/types/invoicing.types.ts` - add, next to `PaymentStatusResult`:

```typescript
/**
 * Command to push an authoritative "paid" state to the provider for an
 * already-issued document (#1362, the outbound counterpart to
 * PaymentStatusReader). `externalInvoiceId` is always the provider-native id
 * from a previously-issued InvoiceRecord - never client-supplied directly.
 */
export interface MarkInvoicePaidCommand {
  externalInvoiceId: string;
  paidDate: Date;
}
```

**Round-2 note (shape asymmetry, non-blocking)**: `getPaymentStatus` (the
read-side sibling) takes the whole `InvoiceRecord`, so it has `documentType`
available even though it doesn't branch on it today. `MarkInvoicePaidCommand`
only carries the two primitives - if a future fix wants `markPaid` to branch
on `documentType` for correction records, this shape would need to widen
(a breaking change), unlike `getPaymentStatus` where the record is already
there. Flagged as a known asymmetry, not fixed for v1 - passing the raw
`externalInvoiceId` keeps this capability's contract minimal and matches
what the issue actually asked for.

**New file**: `domain/ports/capabilities/payment-marker.capability.ts`

```typescript
import type { MarkInvoicePaidCommand } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface PaymentMarker {
  /** Push an authoritative "paid" state to the provider for an already-issued document. */
  markPaid(cmd: MarkInvoicePaidCommand): Promise<void>;
}

export function isPaymentMarker(
  adapter: InvoicingPort,
): adapter is InvoicingPort & PaymentMarker { ... }
```

Doc comment mirrors `payment-status-reader.capability.ts`: neutral vocabulary
litmus, explains this is the outbound counterpart to `PaymentStatusReader`
(#1354), and is explicit that OL still re-reads via `PaymentStatusReader`
afterward for confirmation - while being honest that this confirmation is
**best-effort**, not guaranteed (see §7 - no reconciliation sweep exists for
payment status today, unlike regulatory status).

**Barrel**: add `export * from './domain/ports/capabilities/payment-marker.capability';`
to `libs/core/src/invoicing/index.ts` (alongside the other capability
exports). `MarkInvoicePaidCommand` is already exported via the existing
`export * from './domain/types/invoicing.types';` line - no separate export
needed.

### Integration - `libs/integrations/infakt`

**Edit**: `infakt-invoicing.adapter.ts`
- Add `PaymentMarker` to the `implements` clause.
- New method (the real code - no `.replace()` trick; the first draft's
  illustrative snippet was misleading and is dropped):
  ```typescript
  async markPaid(cmd: MarkInvoicePaidCommand): Promise<void> {
    await this.http.post(`async/invoices/${encodeURIComponent(cmd.externalInvoiceId)}/paid.json`, {
      invoice: { paid_date: cmd.paidDate.toISOString().slice(0, 10) },
    });
    this.logger.log(`Infakt invoice ${cmd.externalInvoiceId} marked as paid`);
  }
  ```
  Path and payload verified live against the sandbox in §2.
- Date formatting: `YYYY-MM-DD` via `toISOString().slice(0, 10)`, matching
  the verified wire format.
- **Correction records** (noted per tech review): like the existing
  `getPaymentStatus`, `markPaid` takes no `documentType`/kind context, so the
  adapter cannot branch for a `'corrected'` record the way `getClearanceStatus`
  does. Marking a correction as "paid" is likely not a meaningful operator
  action (a correction adjusts amounts; payment tracking belongs on the
  original invoice). Rather than a hard block (which could break a legitimate
  flow), the controller now emits a proportionate soft-warning log when
  `record.documentType === 'corrected'` and still proceeds - see the Interface
  section. The adapter itself stays kind-agnostic, matching `getPaymentStatus`.

**Test**: `__tests__/infakt-invoicing.adapter.spec.ts` - new `describe('markPaid', ...)`
block asserting the adapter POSTs to `async/invoices/{id}/paid.json` with the
correctly-formatted date.

### Interface - `apps/api/src/invoicing/http`

**New DTO**: `dto/mark-invoice-paid-request.dto.ts`
```typescript
export class MarkInvoicePaidRequestDto {
  @IsOptional()
  @IsISO8601()
  paidDate?: string; // defaults to "today" (UTC) when omitted
}
```
`@IsISO8601()` confirmed consistent with local precedent - `list-invoices-query.dto.ts`
in this same module already uses `@IsOptional() @IsISO8601()` for
`issuedFrom`/`issuedTo`.

**Controller** (`invoicing.controller.ts`):
- Inject `PAYMENT_STATUS_REFRESH_SERVICE_TOKEN` / `IPaymentStatusRefreshService`
  in the constructor (new 4th dependency).
- New endpoint:
  ```
  @Roles('admin')
  @Post('invoices/:invoiceId/mark-paid')
  @HttpCode(HttpStatus.OK)
  async markInvoicePaid(
    @Param('invoiceId', invoiceIdPipe()) invoiceId: string,
    @Body() dto: MarkInvoicePaidRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InvoiceRecordResponseDto>
  ```
  Flow (mirrors `sendInvoiceEmail` + `resendToKsef`):
  1. `getInvoiceById` → 404 if missing.
  2. `record.providerInvoiceId` missing → 422 (not fully issued).
  3. Resolve adapter via existing `resolveInvoicingAdapter`.
  4. `isPaymentMarker` guard → 501 if unsupported.
  5. **Security-review addition**: log the action at `log()` level (not
     `warn`) BEFORE calling the provider, carrying the acting admin's
     identity - `` `Marking invoice ${invoiceId} (connection=${record.connectionId}) as paid, requested by user ${user.id}` ``.
     Log **only** `user.id` (a UUID, not PII) - never interpolate the whole
     `user` object into the log line, in case `AuthenticatedUser` grows a
     PII field later without this call site being revisited.
     This is the controller's first write that asserts a financial fact to a
     third party with zero automatic verification against the order's real
     settlement state, so - unlike `resendToKsef`/`sendByEmail`, which only
     log the operation - this one logs the actor too.
     **Round-2 correction on framing**: this is NOT introducing a wholly new
     repo-wide pattern - `ai-provider-settings.controller.ts` and
     `content.controller.ts` already thread `@CurrentUser()` into their
     service calls for a *persisted*, queryable actor record (stronger than
     a log line). `InvoiceRecord` has no actor/audit column today, so this
     endpoint falls back to log-only rather than a persisted actor id - that
     richer pattern isn't available here without a migration, which is out
     of scope for this issue.
  6. `adapter.markPaid({ externalInvoiceId: record.providerInvoiceId, paidDate: dto.paidDate ? new Date(dto.paidDate) : new Date() })`,
     provider failure → `toProviderBadGateway` (502).
  7. Best-effort refresh: call `paymentStatusRefreshService.refreshByExternalId(record.connectionId, record.providerInvoiceId)`.
     - If this **throws**, log a warning and swallow - the provider-side mark
       already succeeded (step 6), so the request must not fail on a
       local-projection read-back hiccup.
     - If it returns normally with `outcome: 'unchanged'` (a **non-throwing**,
       perfectly normal return when the async task hasn't completed yet -
       this is NOT an error case and must be tested separately from the
       throw case), that is expected and not a bug; the response still
       reflects the pre-mark `paymentStatus` in that case. This is the
       **accepted, documented behavior** (see §7) - not a defect, since
       there is no reconciliation sweep to self-heal it later, but a
       correctly-marked provider invoice is never lost, only the local
       projection may lag until inFakt fires its own webhook or an operator
       re-triggers a read.
  8. Return `getInvoiceById(invoiceId)` (fresh read) mapped through `toDto`.
- Swagger docs (`@ApiOperation`/`@ApiResponse`) mirroring `resend-to-ksef`'s
  block: 200/404/422/501/502/403. The 200 description explicitly states:
  "The provider mark succeeded; the returned `paymentStatus` reflects OL's
  best-effort immediate re-read and may not yet show `paid` if the
  provider's own processing hasn't completed - this is not a failure."

### Files touched

| File | Change |
|---|---|
| `libs/core/src/invoicing/domain/types/invoicing.types.ts` | +`MarkInvoicePaidCommand` |
| `libs/core/src/invoicing/domain/ports/capabilities/payment-marker.capability.ts` | new |
| `libs/core/src/invoicing/index.ts` | +1 export line (capability; the type is already covered by the existing types-barrel export) |
| `libs/integrations/infakt/src/infrastructure/adapters/infakt-invoicing.adapter.ts` | +implements, +method |
| `libs/integrations/infakt/src/infrastructure/adapters/__tests__/infakt-invoicing.adapter.spec.ts` | +tests |
| `apps/api/src/invoicing/http/dto/mark-invoice-paid-request.dto.ts` | new |
| `apps/api/src/invoicing/http/invoicing.controller.ts` | +import, +DI, +endpoint |
| `apps/api/src/invoicing/http/invoicing.controller.spec.ts` | +tests |

No ORM/migration changes - `InvoiceRecord.paymentStatus` already exists
(#1354). No module-wiring changes needed - `PaymentStatusRefreshService` is
already provided by the core `InvoicingModule`, already imported into
`InvoicingApiModule`. `infakt-plugin.ts` manifest is confirmed unchanged
(§3).

## 5. Testing

- Adapter unit test: `markPaid` posts to the right path with the right body
  (`__tests__/infakt-invoicing.adapter.spec.ts`).
- Controller unit tests (`invoicing.controller.spec.ts`), `describe('markInvoicePaid', ...)`:
  - success path, refresh returns `outcome: 'updated'` → 200, refreshed record.
  - success path, refresh returns `outcome: 'unchanged'` → 200, record
    reflects pre-mark state, **not treated as an error** (tech-review
    addition - this branch is easy to conflate with the throw case if not
    tested separately).
  - `paidDate` omitted from the request → adapter called with today's date
    (tech-review addition - the default-date branch deserves its own
    assertion, not just incidental coverage from the success-path test).
  - 404 - invoice not found.
  - 422 - no `providerInvoiceId` (not fully issued).
  - 501 - adapter doesn't implement `PaymentMarker`.
  - 502 - `adapter.markPaid` throws.
  - refresh service throws - request still returns 200 (best-effort refresh
    doesn't fail the whole call).

## 6. Validation

- Architecture: capability lives in `domain/ports/capabilities/`, its command
  type lives in `domain/types/invoicing.types.ts` (majority precedent), the
  adapter implements it in infra, the controller stays thin (delegates to
  `IInvoiceService`/`IPaymentStatusRefreshService`/capability adapter - never
  a repository port). No cross-context barrel violations.
- Naming: `PaymentMarker`/`isPaymentMarker`, symmetric with its read-side
  sibling `PaymentStatusReader`/`isPaymentStatusReader`. File name
  `payment-marker.capability.ts` matches the `*.capability.ts` convention.
- No `any`, no `console.log`, no secrets, no new credential handling.
- Quality gate: `pnpm lint && pnpm type-check && pnpm test` (scoped to
  `@openlinker/core`, `@openlinker/integrations-infakt`, `@openlinker/api`
  packages primarily).

## 7. Risks / open questions (revised after review)

- **No reconciliation sweep for payment status (corrected claim).** The
  first draft of this plan claimed "the existing PaymentStatusReader /
  reconciliation infra already provides eventual-consistency correction."
  This is **false** - verified against the live tree: unlike
  `RegulatoryStatusReconciliationService` (which `SchedulerService` runs
  every 30 min via `invoicing.regulatoryStatus.reconcile`), there is **no**
  `invoicing.paymentStatus.*` scheduled task. `PaymentStatusRefreshService`
  is invoked in production from exactly one place today: the inbound
  webhook path, triggered only when inFakt fires its own
  `invoice_marked_as_paid` webhook. If our immediate post-`markPaid` refresh
  doesn't observe the new state (async task still queued) AND inFakt never
  separately webhooks back for an OL-triggered mark (plausible - that
  webhook may only fire for provider-detected bank-statement matches), the
  local `paymentStatus` projection can stay stale indefinitely even though
  the provider-side mark succeeded and is durable. **Accepted risk for v1**:
  the provider is the source of truth and is correctly updated regardless;
  only OL's own read-model cache of that fact may lag. A fast-follow issue
  for a `invoicing.paymentStatus.reconcile` sweep (mirroring the regulatory
  one) is a reasonable enhancement but explicitly out of scope here.
- **Async-mark concurrency (double-click) is verified idempotent, but only
  under light-load manual testing.** Re-marking an already-paid sandbox
  invoice returned 201 twice with no error, across two manual sandbox calls.
  This is not the same as verifying provider-side behavior under a genuine
  race (two near-simultaneous marks against the same still-in-flight async
  task). No idempotency guard is added on OL's side regardless, because
  `markPaid` never creates a new fiscal document the way `issueInvoice`
  does - it is a repeatable state-set operation, and even a double-fired
  provider task converges on the same terminal state (`paid`). This is a
  reasonable inference, not a fully load-tested guarantee.
- **Pre-check against local `paymentStatus` (implemented as a soft-warn).**
  The endpoint does not hard-block when `record.paymentStatus` is already
  `'paid'`/`'partially-paid'` before allowing the mark (no automatic
  order-paid verification exists yet, so blocking would be premature), but it
  now emits a proportionate warning log in that case and proceeds at operator
  request - so an admin marking an order paid that OL's own projection
  disagrees with is at least surfaced in the log. Full automatic verification
  against the order's real settlement state remains a v1 non-goal.
- **Financial-write audit trail**: addressed in §4 step 5 - this endpoint
  now logs the acting admin's identity (`user.id` only, never the whole user
  object) before the provider call. None of the other invoicing write
  endpoints do even this log-only version today; not retrofitted here. Note
  this is a *weaker* control than the persisted-actor pattern already used
  by `ai-provider-settings`/`content` controllers (queryable, durable) -
  log-only is the fallback because `InvoiceRecord` has no actor column and
  adding one is a migration, out of scope for this issue.
- **Stale local `paymentStatus` cannot cause an incorrect authorization
  decision elsewhere (confirmed, round 2).** `InvoiceRecord.paymentStatus`
  (this context) and `OrderRecord.paymentStatus` (the `orders` context,
  which gates `ShipmentDispatchService`'s dispatch-blocking check) are
  fully independent fields with independent `PaymentStatus` union types -
  no shared code path reads `InvoiceRecord.paymentStatus`/`isPaid` outside
  this endpoint and the existing webhook refresh path. So the staleness risk
  above is a pure UX/reporting concern, never a security or business-logic
  one.
