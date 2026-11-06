/**
 * Order-hold error copy (#2342, codes since #3863)
 *
 * Both hold conflicts answer 409 with a distinguishable code
 * (`ORDER_ALREADY_ON_HOLD` / `HOLD_ALREADY_RELEASED`, #2341). The two states
 * have DIFFERENT remedies, so the surface branches on the code - never on the
 * message, which is prose the backend is free to reword. The sentence comes
 * from `describeApiError`, in the operator's language.
 *
 * @module apps/web/src/features/orders/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeApiError } from '../../../shared/api/describe-api-error';

const REFRESH_CODES = new Set(['ORDER_ALREADY_ON_HOLD', 'HOLD_ALREADY_RELEASED']);

/** The sentence for a failed hold write. Never blank. */
export function describeHoldWriteError(error: unknown): string {
  return describeApiError(error);
}

/**
 * True when the write lost a race the page can repair by re-reading: the order
 * already has an open hold, or the hold was already released.
 */
export function holdWriteErrorNeedsRefresh(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && REFRESH_CODES.has(error.code);
}
