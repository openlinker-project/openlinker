/**
 * Per-connection opt-in for telling the marketplace as soon as a label is bought.
 *
 * Buying a label and DISPATCHING a parcel are two different acts, and only the
 * operator knows whether their process treats them as one. A warehouse that
 * prints labels in a morning batch and hands the parcels over in the afternoon
 * has a window in which the marketplace has been told the order shipped and the
 * parcel is still on a bench - and a buyer who is told their order shipped and
 * then sees no carrier movement for a day opens a case.
 *
 * So the automatic notification is OFF unless an operator turns it on. The
 * manual "Mark dispatched" action is unaffected and remains the route every
 * install has had; this setting only decides whether buying the label ALSO
 * takes it.
 *
 * @module domain/types
 * @see {@link readStockSafetyBuffer} for the config-coercion precedent this follows
 */
import type { ConnectionConfig } from '@openlinker/core/identifier-mapping';

/** Namespace on `Connection.config` holding shipping-workflow preferences. */
export const SHIPPING_CONFIG_KEY = 'shipping';

/** Key within that namespace. */
export const NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY = 'notifyMarketplaceOnLabelPurchase';

/**
 * Does this connection want a label purchase to notify the marketplace by itself?
 *
 * Coerces defensively and defaults to `false`: anything other than a literal
 * `true` - absent, null, a string, a number, a malformed namespace - means the
 * operator has not opted in. Defaulting the other way would make a
 * misunderstood config value send a buyer-visible "your order shipped".
 */
export function readNotifyOnLabelPurchase(config: ConnectionConfig | null | undefined): boolean {
  if (!config) {
    return false;
  }
  const namespace = config[SHIPPING_CONFIG_KEY];
  if (typeof namespace !== 'object' || namespace === null || Array.isArray(namespace)) {
    return false;
  }
  return (namespace as Record<string, unknown>)[NOTIFY_ON_LABEL_PURCHASE_CONFIG_KEY] === true;
}
