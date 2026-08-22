/**
 * Order Address Redaction
 *
 * The single implementation of OpenLinker's PII redaction rule for an order
 * address, shared by every consumer that must agree on it (#2283).
 *
 * It has two callers with two different jobs, and they MUST use one rule.
 * `OrderRecordService` applies it on the way into the snapshot under
 * `OL_STORE_PII=false`; the ingestion amendment diff applies it to the INCOMING
 * address before comparing against a stored one. If the two ever diverged, every
 * poll of every order would compare a raw address against a redacted one and
 * report a shipping-address change that did not happen — a permanent
 * false-positive storm rather than a subtle drift. Reimplementing the rule twice
 * is what makes that divergence possible, so there is one function.
 *
 * Domain-only: pure, no framework dependencies, no I/O.
 *
 * @module libs/core/src/orders/domain
 */

/** Placeholder written in place of a PII field under `OL_STORE_PII=false`. */
export const REDACTED_PLACEHOLDER = '[REDACTED]';

/** The structural subset of an address this rule reads. */
export interface RedactableAddress {
  address1?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

/** What survives redaction: placeholders plus the (non-PII) country code. */
export interface RedactedAddress {
  address1: string;
  city: string;
  postalCode: string;
  country: string;
}

/**
 * Reduce an address to its non-PII residue.
 *
 * Structure is preserved (so downstream shape checks still hold) while every
 * identifying value becomes {@link REDACTED_PLACEHOLDER}. `country` is kept
 * verbatim — a country code is not personal data, and it is the one field that
 * stays meaningfully comparable in hash-only mode.
 *
 * Returns `undefined` for an absent address, so an order with no address keeps
 * an absent key rather than gaining a wholly-redacted phantom one.
 */
export function redactAddress(
  address: RedactableAddress | null | undefined
): RedactedAddress | undefined {
  if (!address) {
    return undefined;
  }

  return {
    address1: REDACTED_PLACEHOLDER,
    city: REDACTED_PLACEHOLDER,
    postalCode: REDACTED_PLACEHOLDER,
    country: address.country ?? '',
  };
}
