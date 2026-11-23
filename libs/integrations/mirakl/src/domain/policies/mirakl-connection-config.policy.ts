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
  type MiraklEnvironment,
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
