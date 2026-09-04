/**
 * Shipment Retryability (#1918)
 *
 * FE hand-mirror (FE-001 discipline — the FE never value-imports
 * `@openlinker/core/*`) of the BE `deriveRetryabilityClass` /
 * `RetryabilityClass` in
 * `libs/core/src/shipping/domain/provider-code-retryability.ts` +
 * `domain/types/shipping-provider-rejection.types.ts`. Keep the two in sync.
 *
 * Derives a coarse retryability class purely from a `providerCode`'s STRING
 * SHAPE (the family conventions `preflight.*`, `command.*`,
 * `api.http-{status}`) — never from a per-code lookup, since that would
 * require adapter-specific knowledge this module doesn't have. An opaque
 * carrier-surfaced code (e.g. `PARCEL_TOO_LARGE`) is `'unknown'` rather than
 * guessed at.
 *
 * COUPLING (#2873 review): `group-failed-shipments-by-cause.ts`'s
 * `isExactProviderCode` tests `deriveRetryabilityClass(code) !== 'unknown'`
 * to decide whether a `providerCode` is exact enough to key a group on. If
 * you add or widen an arm here (e.g. classifying a `shipx.*` family as
 * `'permanent'`), you are ALSO widening what that grouping treats as an
 * honest shared-cause claim — a code that used to force the coarse,
 * text-keyed branch would start forming a shared-code group instead. No
 * `check-*-mirror.mjs` script guards this; changing this file's behaviour
 * without re-reading `group-failed-shipments-by-cause.ts`'s
 * `isExactProviderCode` tests is how that regression gets silently
 * reintroduced.
 *
 * @module apps/web/src/features/shipments/lib
 */

export const RETRYABILITY_CLASS_VALUES = ['transient', 'permanent', 'auth', 'unknown'] as const;
export type RetryabilityClass = (typeof RETRYABILITY_CLASS_VALUES)[number];

/** Operator-readable label per retryability class. `Record<RetryabilityClass,
 * string>` (not `Partial<>`) so a new class fails type-check until labelled —
 * same discipline as `SHIPPING_METHOD_LABEL`. */
export const RETRYABILITY_LABEL: Record<RetryabilityClass, string> = {
  transient: 'Transient - safe to just retry',
  permanent: 'Needs a fix before retrying',
  auth: 'Connection authentication problem',
  unknown: 'Cause not classified',
};

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
