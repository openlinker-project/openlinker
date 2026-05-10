/**
 * PII Hashing Utilities
 *
 * Provides utilities for hashing PII (Personally Identifiable Information) data
 * using SHA-256 with organization-level salt. Email normalization is the
 * platform-agnostic trim+lowercase baseline; platform-specific identity
 * rules (e.g. Allegro `fixedPart+transactionId@allegromail.*`) live behind
 * `EmailNormalizerPort` in `libs/core/src/integrations` and are dispatched
 * by `EmailNormalizerRegistryService` (#585 / E5).
 *
 * NOTE: `normalizeEmail` / `hashEmail` keep an ignored `_source?: string`
 * parameter as a back-compat shim for pre-#585 callers. Drop the param in
 * a future minor once peerDep consumers have migrated (gated on #596 —
 * semver discipline for `@openlinker/shared`).
 *
 * @module libs/shared/src/config
 */

import { createHash } from 'crypto';
import { getPiiConfig } from './pii-config';

/**
 * Normalize email address for hashing.
 *
 * Trims whitespace and converts to lowercase — the platform-agnostic
 * baseline used by every call site that does not need marketplace-specific
 * rules. Idempotent: `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)`.
 *
 * Marketplace-specific normalization (e.g. Allegro masked emails) is
 * provided by per-adapter `EmailNormalizerPort` implementations registered
 * in `EmailNormalizerRegistryService` — call those upstream and pass the
 * result here.
 *
 * @param email - Email address to normalize
 * @param _source - Deprecated. Kept as an ignored no-op for back-compat
 *   with callers from before #585; new code should not pass it.
 *   Will be removed in a future minor.
 * @returns Normalized email address (trim+lowercase)
 * @deprecated The `_source` parameter is ignored. Use
 *   `EmailNormalizerPort` for source-specific normalization.
 */
export function normalizeEmail(email: string, _source?: string): string {
  if (!email) {
    return '';
  }
  return email.trim().toLowerCase();
}

/**
 * Hash an already-normalized email using SHA-256 with the org-level salt.
 *
 * Re-applies the baseline `normalizeEmail` for safety — idempotent on
 * already-normalized input. Marketplace-specific normalization (e.g.
 * Allegro `+transactionId` stripping) must be applied **before** calling
 * this function, via `EmailNormalizerPort`.
 *
 * @param email - Email address to hash
 * @param _source - Deprecated. Ignored no-op for back-compat with
 *   pre-#585 callers; new code should not pass it.
 * @returns SHA-256 hash of normalized email + salt (hex string)
 * @deprecated The `_source` parameter is ignored. Use
 *   `EmailNormalizerPort` for source-specific normalization upstream.
 */
export function hashEmail(email: string, _source?: string): string {
  const normalized = normalizeEmail(email);
  const config = getPiiConfig();

  const hash = createHash('sha256');
  hash.update(normalized);
  hash.update(config.hashSalt);

  return hash.digest('hex');
}

/**
 * Normalized address fields for hashing
 *
 * Represents address fields that are included in address hash calculation.
 */
export interface NormalizedAddress {
  address1: string;
  address2?: string;
  city: string;
  postcode?: string;
  countryIso2: string;
}

/**
 * Normalize address fields for hashing
 *
 * Normalizes address fields by trimming whitespace and converting to uppercase
 * where appropriate. Name fields (firstname, lastname) are excluded from hash.
 *
 * @param address - Address fields to normalize
 * @returns Normalized address object
 */
export function normalizeAddress(address: NormalizedAddress): NormalizedAddress {
  return {
    address1: (address.address1 || '').trim(),
    address2: address.address2 ? address.address2.trim() : undefined,
    city: (address.city || '').trim(),
    postcode: address.postcode ? address.postcode.trim().toUpperCase() : undefined,
    countryIso2: (address.countryIso2 || '').trim().toUpperCase(),
  };
}

/**
 * Create canonical string from normalized address
 *
 * Creates a deterministic string representation of address fields for hashing.
 * Fields are joined in a consistent order with a delimiter.
 *
 * @param address - Normalized address fields
 * @returns Canonical string representation
 */
function createAddressCanonicalString(address: NormalizedAddress): string {
  const parts = [
    address.address1 || '',
    address.address2 || '',
    address.city || '',
    address.postcode || '',
    address.countryIso2 || '',
  ];

  return parts.join('|');
}

/**
 * Hash address using SHA-256 with organization-level salt
 *
 * Normalizes address fields first, then creates canonical string and hashes with salt.
 * Hash is deterministic per organization (same address + same salt = same hash).
 *
 * Only includes address location fields (address1, address2, city, postcode, countryIso2).
 * Name fields are excluded from hash calculation.
 *
 * @param address - Address fields to hash
 * @returns SHA-256 hash of canonical address + salt (hex string)
 */
export function hashAddress(address: NormalizedAddress): string {
  const normalized = normalizeAddress(address);
  const canonical = createAddressCanonicalString(normalized);
  const config = getPiiConfig();

  const hash = createHash('sha256');
  hash.update(canonical);
  hash.update(config.hashSalt);

  return hash.digest('hex');
}
