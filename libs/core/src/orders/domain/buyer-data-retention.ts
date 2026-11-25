/**
 * Buyer Data Retention - pure rules (#4289)
 *
 * The erase transform on an order snapshot. The per-connection config reader and
 * the effective-rule resolution live in `identifier-mapping`, next to the other
 * `Connection.config` readers, so `ConnectionService` can validate with them.
 *
 * @module libs/core/src/orders/domain
 */
import {
  BUYER_DATA_RETENTION_DEFAULTS,
  type BuyerDataRetentionRule,
} from '@openlinker/core/operational-settings';
import {
  REDACTED_PLACEHOLDER,
  redactAddress,
  type RedactableAddress,
} from './order-address-redaction';

/** The prefix of the code that replaces a buyer's identity after an erase. */
export const BUYER_PLACEHOLDER_PREFIX = 'KUPUJACY';

/**
 * A stable, non-reversible code for an erased buyer, derived from the internal
 * order id (FNV-1a, 6 digits). Two orders of one real person get different
 * codes, which is the point: the code must not re-link them.
 */
export function buildBuyerPlaceholder(internalOrderId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < internalOrderId.length; index += 1) {
    hash ^= internalOrderId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${BUYER_PLACEHOLDER_PREFIX}-${String(hash % 1_000_000).padStart(6, '0')}`;
}

function eraseAddress(value: unknown, placeholder: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const redacted = redactAddress(value as RedactableAddress);
  if (redacted === undefined) {
    return undefined;
  }
  // The buyer's identity becomes the placeholder code; everything else that
  // identifies a person (street, city, postcode, phone, company, tax id) is gone.
  return { ...redacted, firstName: REDACTED_PLACEHOLDER, lastName: placeholder };
}

/**
 * The snapshot with the buyer's personal data replaced. Order content (items,
 * totals, status) is untouched; the email is removed and both addresses reduce
 * to the country plus the placeholder code.
 */
export function eraseBuyerPersonalDataFromSnapshot(
  snapshot: Record<string, unknown>,
  internalOrderId: string
): Record<string, unknown> {
  const placeholder = buildBuyerPlaceholder(internalOrderId);
  const rest: Record<string, unknown> = { ...snapshot };
  delete rest.customerEmail;
  const next: Record<string, unknown> = { ...rest };
  for (const key of ['shippingAddress', 'billingAddress'] as const) {
    if (key in rest) {
      const erased = eraseAddress(rest[key], placeholder);
      if (erased === undefined) {
        delete next[key];
      } else {
        next[key] = erased;
      }
    }
  }
  return next;
}

/** The shipped defaults as a rule, for callers with no settings row to read. */
export const DEFAULT_BUYER_DATA_RULE: BuyerDataRetentionRule = {
  enabled: BUYER_DATA_RETENTION_DEFAULTS.enabled,
  hideAfterDays: BUYER_DATA_RETENTION_DEFAULTS.hideAfterDays,
  eraseAfterDays: BUYER_DATA_RETENTION_DEFAULTS.eraseAfterDays,
  mode: BUYER_DATA_RETENTION_DEFAULTS.mode,
};
