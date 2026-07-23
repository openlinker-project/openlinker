/**
 * Shipping support-reference (traceId) extractor
 *
 * Sniffs the FE `ApiError.details` shape a shipping-command 502 carries for a
 * carrier-side support reference. The controller maps
 * `ShippingProviderRejectionException` to `{ message, providerCode, details:
 * providerDetails }`, so a `providerDetails.traceId` surfaces on the FE at
 * `ApiError.details.details.traceId` — the same nesting depth
 * `extractShippingFieldErrors` reads `fieldErrors` from. Returns the trace id
 * string when present, `null` otherwise (#1800).
 *
 * Provider-generic by construction: any shipping adapter that attaches a
 * `traceId` to `providerDetails` (today DPD Polska, #1777/#1781) renders the
 * same way — no carrier name is hardcoded here.
 *
 * @module features/shipments/lib
 */
import { ApiError } from '../../../shared/api/api-error';

interface TraceIdBody {
  details: {
    traceId: string;
  };
}

function hasTraceId(value: unknown): value is TraceIdBody {
  if (typeof value !== 'object' || value === null) return false;
  const details = (value as { details?: unknown }).details;
  if (typeof details !== 'object' || details === null) return false;
  const traceId = (details as { traceId?: unknown }).traceId;
  return typeof traceId === 'string' && traceId.length > 0;
}

/**
 * Extracts the carrier support-reference (`traceId`) from a shipping-command
 * mutation error, or `null` when the error is not an `ApiError` or carries no
 * `traceId`. Callers render a "quote this to carrier support" line only when a
 * non-null value comes back.
 */
export function extractShippingTraceId(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  return hasTraceId(err.details) ? err.details.details.traceId : null;
}
