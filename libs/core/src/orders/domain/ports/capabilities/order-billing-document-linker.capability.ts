/**
 * Order Billing Document Linker Capability (#3549)
 *
 * Optional ADR-002 sub-capability of the order-source family, the sibling of
 * {@link OrderBillingDocumentUploader}: a marketplace that can show the buyer a
 * LINK to a sales document (rather than holding the file) declares
 * `implements OrderSourcePort, OrderBillingDocumentLinker`. It exists for
 * documents a provider only offers as a url - a verification page, a hosted
 * PDF, an e-receipt - which the uploader cannot carry without OpenLinker
 * fetching a provider-controlled url, which it never does.
 *
 * A separate capability rather than a variant of the uploader's input, so an
 * adapter that already implements the uploader keeps compiling unchanged and a
 * marketplace may offer either one without the other.
 *
 * **Advertised-without-dispatch**, like the uploader: resolved by narrowing the
 * dispatched `OrderSource` adapter with {@link isOrderBillingDocumentLinker},
 * never by capability name, and absent from `CoreCapabilityValues`.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 */
import type {
  AttachBillingDocumentLinkInput,
  UploadBillingDocumentResult,
} from '../../types/order-billing-document.types';

export interface OrderBillingDocumentLinker {
  /**
   * Attach a link to the document to the marketplace order. Idempotent at the
   * adapter level: a link the order already carries is `already-present`. A
   * link the marketplace will not take (a domain it does not accept) is
   * `unsupported`, since no retry of the same url changes the answer. Never
   * throws for a modelled condition.
   */
  attachBillingDocumentLink(
    input: AttachBillingDocumentLinkInput
  ): Promise<UploadBillingDocumentResult>;
}

export function isOrderBillingDocumentLinker<T extends object>(
  adapter: T
): adapter is T & OrderBillingDocumentLinker {
  return (
    typeof (adapter as Partial<OrderBillingDocumentLinker>).attachBillingDocumentLink === 'function'
  );
}
