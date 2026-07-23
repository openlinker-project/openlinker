/**
 * Delivery-mapping deep-link contract (#1794)
 *
 * Shared contract for the "Add mapping" fix-it deep link that the order-detail
 * delivery rider (#1793) points at. The orders feature builds the link; the
 * connection-mappings page parses these params to pre-select the Delivery
 * (carriers) tab and pre-focus the unmapped source delivery method.
 *
 * Centralised here so the producer (orders) and consumer (connections page)
 * can't drift on param names or the target tab id.
 *
 * @module apps/web/src/features/mappings/lib
 */

/** Query-param keys carried by the Add-mapping deep link. */
export const DELIVERY_MAPPING_DEEP_LINK_PARAMS = {
  /** Which mappings tab to open. */
  tab: 'tab',
  /** Source delivery-method id to pre-focus. */
  method: 'method',
  /** Human label for the pre-focused method (fallback copy when options lag). */
  methodName: 'methodName',
} as const;

/** The mappings tab that owns source-delivery-method → carrier rows. */
export const DELIVERY_MAPPING_TAB = 'carriers';

export interface DeliveryMappingLinkInput {
  connectionId: string;
  sourceDeliveryMethodId?: string | null;
  sourceDeliveryMethodName?: string | null;
}

/**
 * Build the deep link to a connection's Delivery (carriers) mapping tab,
 * carrying the unmapped source method so the page can pre-focus it.
 */
export function buildDeliveryMappingLink({
  connectionId,
  sourceDeliveryMethodId,
  sourceDeliveryMethodName,
}: DeliveryMappingLinkInput): string {
  const params = new URLSearchParams();
  params.set(DELIVERY_MAPPING_DEEP_LINK_PARAMS.tab, DELIVERY_MAPPING_TAB);
  if (sourceDeliveryMethodId) {
    params.set(DELIVERY_MAPPING_DEEP_LINK_PARAMS.method, sourceDeliveryMethodId);
  }
  if (sourceDeliveryMethodName) {
    params.set(DELIVERY_MAPPING_DEEP_LINK_PARAMS.methodName, sourceDeliveryMethodName);
  }
  return `/connections/${encodeURIComponent(connectionId)}/mappings?${params.toString()}`;
}
