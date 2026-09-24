/**
 * Subiekt Bridge Transport Retryability (#2348 audit item B2)
 *
 * Shared classification of a raw `fetch` transport failure into the
 * fiscal-safety retryability phase (`'safe'` vs `'indeterminate'`), plus the
 * client-private error subclass that carries it across the frozen
 * `SubiektBridgeUnreachableError` boundary.
 *
 * Extracted from `subiekt-bridge-http.client.ts` (Invoicing), which had the
 * only correct implementation — every OTHER Subiekt bridge client
 * (Inventory, Orders, and `SubiektProductMasterAdapter`'s own private
 * transport) threw a BARE `SubiektBridgeUnreachableError` on transport
 * failure with no phase set at all. Because `SubiektInventoryMasterAdapter`
 * /`SubiektInvoicingAdapter`'s own `readRetryability` helpers default an
 * absent phase to `'indeterminate'`, and the shared
 * `SubiektRetryClassifierAdapter.isNonRetryable` treats anything short of
 * `'safe'` as non-retryable (correct fiscal-safety posture for an ambiguous
 * invoicing POST — WRONG for a side-effect-free inventory GET), every
 * transient network blip against the inventory bridge killed the job on
 * attempt 1 instead of entering the normal 10-attempt retry ladder —
 * live-reproduced: 41/43 `master.inventory.syncFromSweep` jobs died
 * `attempts=0` in one ~2-minute bridge-restart window.
 *
 * One classification, one error subclass, every Subiekt HTTP client uses it.
 *
 * @module libs/integrations/subiekt/src/bridge
 */
import { SubiektBridgeUnreachableError } from './subiekt-bridge.errors';
import type { SubiektTransportRetryability } from '../domain/types/subiekt-transport-retryability.types';

/**
 * Node error codes that PROVE the request never left the host (connect-refused
 * / DNS-failure). Only these are classified `'safe'` — auto-retry cannot
 * double-issue a fiscal document, and is unconditionally safe for a
 * non-fiscal read/write too. Everything else is `'indeterminate'`.
 */
const SAFE_RETRY_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

/** Extract a `cause.code` string from an unknown thrown value, if present. */
export function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  // AbortError surfaces via `name` rather than a cause code.
  const name = (error as { name?: unknown }).name;
  if (name === 'AbortError') return 'ABORT';
  return undefined;
}

/** Map a raw fetch error code to the fiscal-safety retryability phase. */
export function classifyRetryability(code: string | undefined): SubiektTransportRetryability {
  return code !== undefined && SAFE_RETRY_CODES.has(code) ? 'safe' : 'indeterminate';
}

/**
 * Client-private subclass of the frozen unreachable error that carries the
 * retryability phase across the frozen-error boundary. IS-A
 * `SubiektBridgeUnreachableError`, so `instanceof` checks (and any per-client
 * contract suite / fake) remain valid. NOT exported from the package barrel.
 */
export class SubiektBridgeUnreachableWithPhaseError extends SubiektBridgeUnreachableError {
  readonly retryability: SubiektTransportRetryability;

  constructor(message: string, retryability: SubiektTransportRetryability) {
    super(message);
    this.name = 'SubiektBridgeUnreachableWithPhaseError';
    this.retryability = retryability;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Convenience: classify a raw caught transport error (e.g. from a `fetch`
 * catch block) straight into the phase-carrying error, in one call.
 */
export function toUnreachableWithPhase(error: unknown, prefix: string): SubiektBridgeUnreachableWithPhaseError {
  const code = extractErrorCode(error);
  const retryability = classifyRetryability(code);
  return new SubiektBridgeUnreachableWithPhaseError(`${prefix} (${code ?? 'unknown'})`, retryability);
}
