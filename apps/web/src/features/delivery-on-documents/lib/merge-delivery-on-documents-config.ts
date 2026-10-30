/**
 * Merge Delivery On Documents Config (#3908)
 *
 * Applies the delivery-line settings onto a connection's freshly fetched
 * `config`. `PATCH /connections/:id` replaces `config` wholesale, so only the
 * one key this tab owns is touched and every other key a sibling panel wrote
 * (`rateLimit`, `pricingRule`, `salesDocument`, ...) survives. An empty
 * configuration removes the key instead of writing a hollow object.
 *
 * @module apps/web/src/features/delivery-on-documents/lib
 */
import { DELIVERY_ON_DOCUMENTS_CONFIG_KEY, type DeliveryOnDocumentsConfig } from './delivery-line';

export function mergeDeliveryOnDocumentsConfig(
  existingConfig: Record<string, unknown>,
  next: DeliveryOnDocumentsConfig | null,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existingConfig };
  if (next === null) delete merged[DELIVERY_ON_DOCUMENTS_CONFIG_KEY];
  else merged[DELIVERY_ON_DOCUMENTS_CONFIG_KEY] = next;
  return merged;
}
