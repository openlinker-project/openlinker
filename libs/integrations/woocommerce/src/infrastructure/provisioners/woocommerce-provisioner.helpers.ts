/**
 * WooCommerce Provisioner Helpers
 *
 * Pure helpers shared by the WooCommerce customer + address provisioners:
 * country normalization (WooCommerce's model is flat — there is no separate
 * resolver layer, so this lives alongside the provisioners), address hashing,
 * OL-Address → WC-address mapping, and a bounded-wait distributed-lock
 * acquisition built on the host `SyncLockPort`.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners
 */
import { createHash } from 'crypto';
import type { SyncLockPort, SyncLockToken } from '@openlinker/core/sync';
import type { Address } from '@openlinker/core/orders';
import type { NormalizedAddress } from '@openlinker/shared/config';
import { hashAddress } from '@openlinker/shared/config';
import type { WooCommerceOrderAddress } from '../adapters/order-processor/woocommerce-order.types';

/** Lock TTL in milliseconds — 30 s is ample for the WC customer API round-trips. */
export const PROVISIONER_LOCK_TTL_MS = 30_000;

/** Default bounded-wait parameters for lock acquisition. */
const DEFAULT_MAX_ACQUIRE_ATTEMPTS = 20;
const DEFAULT_ACQUIRE_DELAY_MS = 100;

/**
 * Derive a stable, non-reversible token from a value for use inside a Redis
 * lock key — keeps raw PII (e.g. buyer email) out of the key space. This is a
 * plain SHA-256, deliberately independent of the org-level PII salt (a lock key
 * is ephemeral and never persisted), so it works in any runtime without PII
 * config wiring.
 */
export function lockKeyToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Normalize a country code to an upper-case ISO-3166 alpha-2 value. WooCommerce
 * expects upper-case ISO2 in address `country`; normalizing here keeps the value
 * we hash for reuse consistent with the value we write.
 */
export function normalizeCountryCode(country: string | null | undefined): string {
  return (country ?? '').trim().toUpperCase();
}

/**
 * Compute the address-reuse hash for an OL order address. Mirrors the component
 * set used across the platform (`address1`, `address2`, `city`, `postcode`,
 * `countryIso2`), with the country normalized so a reuse lookup matches the
 * value written to WooCommerce.
 */
export function computeAddressHash(address: Address): string {
  const normalized: NormalizedAddress = {
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    postcode: address.postalCode,
    countryIso2: normalizeCountryCode(address.country),
  };
  return hashAddress(normalized);
}

/**
 * Compute the reuse hash of a WooCommerce inline address (recovery path — when
 * the mapping table has no row but the WC customer already carries a matching
 * address). Returns null when the WC address lacks the fields needed to hash.
 */
export function computeWcAddressHash(address: WooCommerceOrderAddress | undefined): string | null {
  if (!address || !address.address_1 || !address.city || !address.postcode) {
    return null;
  }
  const normalized: NormalizedAddress = {
    address1: address.address_1,
    address2: address.address_2,
    city: address.city,
    postcode: address.postcode,
    countryIso2: normalizeCountryCode(address.country),
  };
  return hashAddress(normalized);
}

/**
 * Map an OL Address to a WooCommerce inline customer address, omitting nullish
 * fields (WC REST rejects `null` on string-typed address properties) and
 * normalizing the country code.
 *
 * Shares the `WooCommerceOrderAddress` wire type with the order-processor
 * adapter's private `mapAddress`, but stays a separate function on purpose: it
 * normalizes `country` (upper-case ISO2) so the value written to the WC customer
 * matches the value fed into the reuse hash (`computeAddressHash`). The adapter's
 * `mapAddress` deliberately passes `country` through verbatim for the order
 * payload, so the two are not interchangeable.
 */
export function toWcCustomerAddress(address: Address): WooCommerceOrderAddress {
  const mapped: WooCommerceOrderAddress = {};
  const assign = (key: keyof WooCommerceOrderAddress, value: string | null | undefined): void => {
    if (value !== null && value !== undefined) mapped[key] = value;
  };
  assign('first_name', address.firstName);
  assign('last_name', address.lastName);
  assign('company', address.company);
  assign('address_1', address.address1);
  assign('address_2', address.address2);
  assign('city', address.city);
  assign('state', address.state);
  assign('postcode', address.postalCode);
  assign('country', normalizeCountryCode(address.country));
  assign('phone', address.phone);
  return mapped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a distributed lock with a bounded wait. Retries `acquire` until it
 * succeeds or the attempt budget is exhausted, so a second caller for the same
 * key serializes behind the first holder rather than racing it.
 *
 * @returns the lock token on success, or `null` if the lock could not be
 *   acquired within the budget (caller must re-check state and degrade safely).
 */
export async function acquireLockWithWait(
  syncLock: SyncLockPort,
  key: string,
  ttlMs: number = PROVISIONER_LOCK_TTL_MS,
  maxAttempts: number = DEFAULT_MAX_ACQUIRE_ATTEMPTS,
  delayMs: number = DEFAULT_ACQUIRE_DELAY_MS,
): Promise<SyncLockToken | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await syncLock.acquire(key, ttlMs);
    if (token) return token;
    await sleep(delayMs);
  }
  return null;
}
