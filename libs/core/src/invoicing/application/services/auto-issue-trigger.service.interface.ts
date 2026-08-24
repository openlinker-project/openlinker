/**
 * Auto-Issue Trigger Service Interface (ADR-026 §3 — core policy composer;
 * ADR-041 decision 7 — cross-capability gate, #2156)
 *
 * Outward contract of the core policy service that turns a qualifying order
 * transition into AT MOST ONE sales-document issuance job (OL #1120, #2156,
 * #2173). It resolves EXACTLY ONE `(documentKind, connectionId)` pair —
 * invoice **or** fiscal receipt, never both (ADR-041 decision 3a) — first by
 * consulting the country-agnostic rule engine (`ISalesDocumentRulesService`,
 * #2170) and, only when that engine reports no configuration at all for the
 * order's country, falling back to the pre-#2170 single-primary
 * `resolveSalesDocumentRouting` (#2155). It then validates the resolved
 * connection actually supports that kind, reads its trigger model, evaluates
 * whether the transition qualifies, composes the matching job payload from
 * the clean in-hand `Order`, and enqueues one deterministic-keyed job
 * (`invoicing.issue` for `'invoice'`, `fiscalization.register` for
 * `'fiscal-receipt'`).
 *
 * ONE-WAY EDGE INVARIANT (F3): the implementation MUST NOT inject any
 * OrdersModule-provided token. The `Order` (and `sourceConnectionId` /
 * `sourceEventId`) arrive as METHOD ARGUMENTS, never via DI.
 *
 * @module libs/core/src/invoicing/application/services
 * @see {@link AutoIssueTriggerService} for the implementation
 */
import type { Order } from '@openlinker/core/orders';
import type { SalesDocumentBlockOutcome } from '@openlinker/core/sales-documents';

export interface IAutoIssueTriggerService {
  /**
   * Evaluate a qualifying order transition and enqueue at most one issuance job.
   *
   * @param order - The clean, fully-hydrated `Order` at transition time (carries
   *   real buyer billing/shipping — the only PII-complete copy in the flow).
   * @param sourceConnectionId - The order's source connection id.
   * @param sourceEventId - The only trace token at the seam (NO `correlationId`
   *   exists — D10); threaded into the job payload and every log envelope.
   *
   * @returns A `SalesDocumentBlockOutcome` (#2100, ADR-041 decision 11) the caller
   *   persists onto the order:
   *   - `blocked`       — write the named reason.
   *   - `none`          — CLEAR any persisted reason. Returned when the job was
   *     enqueued, when the order is merely waiting for its trigger condition, when
   *     no invoicing connection exists at all, and when the order ALREADY carries a
   *     fiscal document (the gate suppresses its own block in that case, so a later
   *     transition cannot re-label an invoiced order).
   *   - `indeterminate` — LEAVE THE PERSISTED VALUE ALONE. Returned on a
   *     compose/enqueue error and on the unreachable defensive branch: with the
   *     answer unknown, clearing could erase a true reason and blocking could
   *     invent one.
   *
   *   The value is REPORTED, not persisted, and that is load-bearing: persisting it
   *   would mean injecting an OrdersModule token here and closing a runtime DI
   *   cycle `OrdersModule → InvoicingModule → OrdersModule` that the one-way-edge
   *   invariant above (and `invoicing-auto-issue-boot.int-spec.ts`) exists to
   *   prevent. The caller already lives in the orders context and owns the write.
   *
   *   Callers MUST honour `none` as a write of `null` — that is the level-triggered
   *   clear, and without it a reason persisted once would outlive the
   *   misconfiguration that caused it.
   */
  onOrderTransition(
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<SalesDocumentBlockOutcome>;
}
