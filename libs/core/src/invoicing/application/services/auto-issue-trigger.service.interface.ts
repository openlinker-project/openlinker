/**
 * Auto-Issue Trigger Service Interface (ADR-026 §3 — core policy composer)
 *
 * Outward contract of the core policy service that turns a qualifying order
 * transition into per-connection issuance jobs (OL #1120). It sits ABOVE the
 * invoicing port: it reads the per-connection trigger model, evaluates whether
 * the transition qualifies, composes the `IssueInvoiceCommand` from the clean
 * in-hand `Order`, and enqueues one deterministic-keyed `invoicing.issue` job
 * per matching invoicing connection. No rules engine — direct enqueue.
 *
 * ONE-WAY EDGE INVARIANT (F3): the implementation MUST NOT inject any
 * OrdersModule-provided token. The `Order` (and `sourceConnectionId` /
 * `sourceEventId`) arrive as METHOD ARGUMENTS, never via DI.
 *
 * @module libs/core/src/invoicing/application/services
 * @see {@link AutoIssueTriggerService} for the implementation
 */
import type { Order } from '@openlinker/core/orders';
import type { SalesDocumentBlock } from '@openlinker/core/sales-documents';

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
   * @returns The named reason issuance was BLOCKED for this order, or `null` when
   *   it was enqueued, is merely waiting for its trigger condition, or there is no
   *   invoicing connection at all (#2100, ADR-041 decision 11).
   *
   *   The value is REPORTED, not persisted, and that is load-bearing: persisting it
   *   would mean injecting an OrdersModule token here and closing a runtime DI
   *   cycle `OrdersModule → InvoicingModule → OrdersModule` that the one-way-edge
   *   invariant above (and `invoicing-auto-issue-boot.int-spec.ts`) exists to
   *   prevent. The caller already lives in the orders context and owns the write.
   *
   *   Callers MUST write `null` through as well — that is the level-triggered
   *   clear, and without it a reason persisted once would outlive the
   *   misconfiguration that caused it.
   */
  onOrderTransition(
    order: Order,
    sourceConnectionId: string,
    sourceEventId?: string,
  ): Promise<SalesDocumentBlock | null>;
}
