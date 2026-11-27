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
 * Whether a failure means the surface is out of date and should refetch.
 *
 * Both conflicts do: in each case the server holds a truth this client does
 * not, and re-reading is what makes the next attempt meaningful. Called from
 * the `onError` of both hold mutation hooks.
 *
 * `ORDER_HOLD_CONTENDED` is deliberately NOT included: it means a peer took and
 * RELEASED the slot, so the client's view is not stale - the remedy is to press
 * the button again, and that code's copy says so.
 */
export function holdWriteErrorNeedsRefresh(error: unknown): boolean {
  return error instanceof ApiError && error.code !== undefined && REFRESH_CODES.has(error.code);
}
