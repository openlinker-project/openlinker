/**
 * Mirakl Connection Config Policy
 *
 * Pure rules for reading a Mirakl connection's config: which base URL an
 * environment means, and whether a shop id is usable. Shared by the config
 * validator (refuses a bad value on save) and the adapter factory (refuses it
 * again before a request, for rows written outside the validator).
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import {
  MiraklEnvironmentValues,
  MiraklOrderAcceptanceValues,
  type MiraklEnvironment,
  type MiraklOrderAcceptance,
} from '../types/mirakl-connection.types';
import type { MiraklOperatorProfile } from '../types/mirakl-operator-profile.types';

export function isMiraklEnvironment(value: unknown): value is MiraklEnvironment {
  return typeof value === 'string' && (MiraklEnvironmentValues as readonly string[]).includes(value);
}

/**
 * Base URL for a connection. An absent or unrecognised environment resolves to
 * production: the validator refuses an unrecognised value on save, so reaching
 * this with one means a row written around it, and production is where a
 * seller's live key works.
 */
export function resolveMiraklBaseUrl(profile: MiraklOperatorProfile, environment: unknown): string {
  return isMiraklEnvironment(environment) ? profile.baseUrls[environment] : profile.baseUrls.production;
}

/** Result of reading `config.shopId`. */
export type MiraklShopIdReading =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly shopId: string }
  | { readonly kind: 'invalid' };

/**
 * A shop id is a positive integer, given as a number or a digit string (a form
 * field submits a string). Returned as a string because it only ever travels
 * as a query parameter.
 */
export function readMiraklShopId(value: unknown): MiraklShopIdReading {
  if (value === undefined || value === null || value === '') {
    return { kind: 'absent' };
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
      ? { kind: 'valid', shopId: String(value) }
      : { kind: 'invalid' };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^[1-9]\d{0,15}$/.test(trimmed) ? { kind: 'valid', shopId: trimmed } : { kind: 'invalid' };
  }
  return { kind: 'invalid' };
}

export function isMiraklOrderAcceptance(value: unknown): value is MiraklOrderAcceptance {
  return (
    typeof value === 'string' && (MiraklOrderAcceptanceValues as readonly string[]).includes(value)
  );
}

/**
 * Acceptance mode for a connection. Only an explicit `off` turns acceptance
 * off: the validator refuses any other value on save, and a row written around
 * it should keep the default rather than silently stop accepting.
 */
export function resolveMiraklOrderAcceptance(value: unknown): MiraklOrderAcceptance {
  return value === 'off' ? 'off' : 'auto';
}

/** Result of reading `config.carrierCodes`. */
export type MiraklCarrierCodesReading =
  | { readonly kind: 'valid'; readonly codes: Readonly<Record<string, string>> }
  | { readonly kind: 'invalid' };

/**
 * `carrierCodes` maps a shipping connection's `platformType` to a carrier
 * code from the operator's SH21 list. Keys are matched lower-cased; an absent
 * map is an empty one.
 */
export function readMiraklCarrierCodes(value: unknown): MiraklCarrierCodesReading {
  if (value === undefined || value === null) {
    return { kind: 'valid', codes: {} };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'invalid' };
  }
  const codes: Record<string, string> = {};
  for (const [key, code] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() === '' || typeof code !== 'string' || code.trim() === '') {
      return { kind: 'invalid' };
    }
    codes[key.trim().toLowerCase()] = code.trim();
  }
  return { kind: 'valid', codes };
}
