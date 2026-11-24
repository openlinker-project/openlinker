/**
 * Order Billing Document Uploader Capability (#3549)
 *
 * Optional ADR-002 sub-capability of the order-source family: a marketplace
 * adapter that can attach an issued sales document (an invoice or a receipt
 * summary) to the order it came from declares `implements OrderSourcePort,
 * OrderBillingDocumentUploader`. It is the sibling of {@link OrderStatusWriteback}
 * - both push a fact back to the originating order - and follows the same rule:
 * what a platform cannot do is reported through the result, not the signature.
 *
 * **Advertised-without-dispatch.** It is resolved by narrowing the dispatched
 * `OrderSource` adapter with {@link isOrderBillingDocumentUploader}, never by
 * `getCapabilityAdapter(connectionId, 'OrderBillingDocumentUploader')`, and it
 * is absent from `CoreCapabilityValues`. Gating on a new capability NAME would
 * exempt every existing connection, since `enabledCapabilities` is stamped at
 * create and never retro-filled (#2085).
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 */
import type {
  UploadBillingDocumentInput,
  UploadBillingDocumentResult,
} from '../../types/order-billing-document.types';

export interface OrderBillingDocumentUploader {
  /**
   * Attach the document to the marketplace order. Idempotent at the adapter
   * level: a document the marketplace already holds for the order is the
   * `already-present` outcome, not a failure. Never throws for a modelled
   * condition; an unmodelled failure may throw and is treated as transient.
   */
  uploadBillingDocument(input: UploadBillingDocumentInput): Promise<UploadBillingDocumentResult>;
}

export function isOrderBillingDocumentUploader<T extends object>(
  adapter: T,
): adapter is T & OrderBillingDocumentUploader {
  return (
    typeof (adapter as Partial<OrderBillingDocumentUploader>).uploadBillingDocument === 'function'
  );
}
