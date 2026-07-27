/**
 * Shipping trace-id extractor
 *
 * Sniffs the FE `ApiError.details` shape a shipping-command 502 carries for a
 * carrier-assigned support reference. `shipment.controller.ts` maps
 * `ShippingProviderRejectionException` to `{ message, providerCode, details:
 * providerDetails }`, so any `traceId` an adapter merges into
 * `providerDetails` (DPD does this for undiagnosable `NOT_PROCESSED`
 * rejections, #1777) lands at `ApiError.details.details.traceId` — the same
 * nested `details.details.*` envelope `extractShippingFieldErrors` reads.
 * Returns the trimmed trace id when present, `null` otherwise so callers
 * render nothing.
 *
 * Provider-generic by construction: it reads whatever `traceId` the 502 body
 * carries — no carrier name is hardcoded here. Any shipping adapter that
 * merges a `traceId` into `providerDetails` surfaces the same way (#1800).
 *
 * @module features/shipments/lib
 */
import { ApiError } from '../../../shared/api/api-error';

/**
 * Extracts a carrier-assigned support reference (`traceId`) from a
 * shipping-command mutation error. Returns `null` unless the error is an
 * `ApiError` whose nested `details.details.traceId` is a non-empty string.
 */
export function extractShippingTraceId(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  if (typeof err.details !== 'object' || err.details === null) return null;

  const inner = (err.details as { details?: unknown }).details;
  if (typeof inner !== 'object' || inner === null) return null;

  const traceId = (inner as { traceId?: unknown }).traceId;
  if (typeof traceId !== 'string') return null;

  const trimmed = traceId.trim();
  return trimmed.length > 0 ? trimmed : null;
}
