/**
 * Provider Code Retryability Derivation
 *
 * Pure derivation of a coarse `RetryabilityClass` (#1918) from a shipment's
 * `providerCode`, using only the code's string shape — the family
 * conventions documented in `shipping-provider-rejection.types.ts`
 * (`preflight.*`, `command.*`, `api.http-{status}`). No I/O, no framework
 * deps, no adapter-specific knowledge — an opaque carrier-surfaced code
 * (e.g. `PARCEL_TOO_LARGE`) is deliberately left `'unknown'` rather than
 * guessed at.
 *
 * @module libs/core/src/shipping/domain
 */
import type { RetryabilityClass } from './types/shipping-provider-rejection.types';

const HTTP_CODE_PATTERN = /^api\.http-(\d{3})$/;

export function deriveRetryabilityClass(providerCode: string | null): RetryabilityClass {
  if (providerCode === null) return 'unknown';

  const httpMatch = HTTP_CODE_PATTERN.exec(providerCode);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 403) return 'auth';
    if (status === 429 || status >= 500) return 'transient';
    return 'permanent';
  }

  if (providerCode.startsWith('preflight.')) return 'permanent';
  if (providerCode.startsWith('command.')) return 'permanent';
  if (providerCode === 'target_point') return 'permanent';

  return 'unknown';
}
