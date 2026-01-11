/**
 * PII Hashing Utilities
 *
 * Provides utilities for hashing PII (Personally Identifiable Information) data
 * using SHA-256 with organization-level salt. Includes email normalization with
 * special handling for Allegro masked emails.
 *
 * @module libs/shared/src/config
 */

import { createHash } from 'crypto';
import { getPiiConfig } from './pii-config';

/**
 * Normalize email address for hashing
 *
 * Normalizes email by trimming whitespace and converting to lowercase.
 * For Allegro masked emails (domain `@allegromail.*`), strips anything after
 * `+` in the local part to use the stable buyer identifier.
 *
 * Example:
 * - `8awgqyk6a5+cub31c122@allegromail.pl` → `8awgqyk6a5@allegromail.pl`
 * - `Customer@Example.com` → `customer@example.com`
 *
 * @param email - Email address to normalize
 * @param _source - Optional source identifier (e.g., 'allegro') for source-specific normalization (reserved for future use)
 * @returns Normalized email address
 */
export function normalizeEmail(email: string, _source?: string): string {
  if (!email) {
    return '';
  }

  // Trim and lowercase
  let normalized = email.trim().toLowerCase();

  // Handle Allegro masked emails: strip transaction identifier after '+'
  // Allegro masked emails have format: fixedPart+transactionId@allegromail.*
  // The fixed part is stable per buyer, transaction ID changes per order
  if (normalized.includes('@allegromail.')) {
    const [localPart, domain] = normalized.split('@');
    if (localPart && localPart.includes('+')) {
      // Strip everything after '+' in local part
      const stablePart = localPart.split('+')[0];
      normalized = `${stablePart}@${domain}`;
    }
  }

  return normalized;
}

/**
 * Hash email address using SHA-256 with organization-level salt
 *
 * Normalizes email first (handles Allegro masked emails), then hashes with salt.
 * Hash is deterministic per organization (same email + same salt = same hash).
 *
 * @param email - Email address to hash
 * @param source - Optional source identifier for source-specific normalization
 * @returns SHA-256 hash of normalized email + salt (hex string)
 */
export function hashEmail(email: string, source?: string): string {
  const normalized = normalizeEmail(email, source);
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
