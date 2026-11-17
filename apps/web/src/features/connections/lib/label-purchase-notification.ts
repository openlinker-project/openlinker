/**
 * Label-purchase notification flag (#4097)
 *
 * Browser-side reader for `Connection.config.shipping.notifyMarketplaceOnLabelPurchase`:
 * when on, buying a carrier label also tells the shop or marketplace the order
 * shipped. The browser cannot import `@openlinker/core` (#591), so this mirrors
 * core's `readNotifyOnLabelPurchase` - only a literal `true` inside an object
 * namespace reads as on, so a mistyped value never sends a buyer-visible
 * "shipped". `scripts/check-label-purchase-notify-mirror.mjs` keeps the two key
 * names equal to core's.
 *
 * @module features/connections/lib
 */

/** Namespace on `config`. Mirrors `SHIPPING_CONFIG_KEY` in core. */
export const SHIPPING_CONFIG_KEY = 'shipping';

/** Key inside the namespace. Mirrors `NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY` in core. */
export const NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY = 'notifyMarketplaceOnLabelPurchase';

export function readNotifyOnLabelPurchase(config: Record<string, unknown> | null | undefined): boolean {
  const namespace = config?.[SHIPPING_CONFIG_KEY];
  if (typeof namespace !== 'object' || namespace === null || Array.isArray(namespace)) {
    return false;
  }
  return (namespace as Record<string, unknown>)[NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY] === true;
}
