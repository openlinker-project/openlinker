/**
 * Order-hold error copy (#2342)
 *
 * Both hold conflicts answer 409 and carry a distinguishable machine-readable
 * code in the body (`ORDER_ALREADY_ON_HOLD` / `HOLD_ALREADY_RELEASED`, #2341).
 * The two states have DIFFERENT remedies, so the surface branches on the code —
 * never on the message, which is prose the backend is free to reword.
 *
 * `ApiError.details` carries the parsed response body, so no change to the
 * shared client is needed to read it.
 *
 * @module apps/web/src/features/orders/lib
 */
import { ApiError } from '../../../shared/api/api-error';

/** Read the backend's `error` code off a conflict body, if it carries one. */
function readErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const code = (details as { error?: unknown }).error;
  return typeof code === 'string' ? code : null;
}

/**
 * Operator-facing message for a failed hold write.
 *
 * A recognised conflict says what actually happened and what to do; anything
 * else falls back to the server's own message rather than a generic sentence
 * that would hide a 400 naming a missing note.
 */
export function describeHoldWriteError(error: unknown, fallback: string): string {
  switch (readErrorCode(error)) {
    case 'ORDER_ALREADY_ON_HOLD':
      return 'This order is already on hold. The open hold is being loaded now.';
    case 'HOLD_ALREADY_RELEASED':
      return 'This hold was already released. The order is being reloaded now.';
    default:
      return (error instanceof Error && error.message) || fallback;
  }
}

/**
 * Whether a failure means the surface is out of date and should refetch.
 *
 * Both conflicts do: in each case the server holds a truth this client does
 * not, and re-reading is what makes the next attempt meaningful.
 *
 * Called from the `onError` of both hold mutation hooks. It was exported and
 * unused for a while, next to copy telling the operator to reload by hand — on
 * a screen where every success path already invalidates. The copy above now
 * describes what actually happens instead.
 *
 * `ORDER_HOLD_CONTENDED` is deliberately NOT included: it means a peer took and
 * RELEASED the slot, so the client's view is not stale — the remedy is to press
 * the button again, and the server's own message says so.
 */
export function holdWriteErrorNeedsRefresh(error: unknown): boolean {
  const code = readErrorCode(error);
  return code === 'ORDER_ALREADY_ON_HOLD' || code === 'HOLD_ALREADY_RELEASED';
}
