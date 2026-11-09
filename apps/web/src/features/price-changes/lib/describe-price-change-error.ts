/**
 * describePriceChangeActionError (#3148, #3873)
 *
 * Maps a price-change write failure to operator-facing copy (#3148 review,
 * finding 9). With a 30 s background poll and a per-dialog version
 * snapshot, a 409 (the episode changed again since it was opened) is a
 * ROUTINE outcome; the backend exception text carries episode ids and raw
 * version tokens, so it never reaches the toast. The raw error still belongs
 * in `console.error` for debugging.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { getMessages, interpolate } from '../../../shared/i18n';

export function describePriceChangeActionError(error: unknown): string {
  const copy = getMessages('price-changes').describePriceChangeError;
  if (error instanceof ApiError) {
    if (error.isConflict()) {
      return copy.conflict;
    }
    if (error.status === 422) {
      if (error.message.includes('currency-mismatch')) {
        return copy.currencyMismatch;
      }
      return copy.blocked;
    }
  }
  // Any other server text is shown behind a translated prefix, never bare.
  return error instanceof Error && error.message
    ? interpolate(copy.withServerMessage, { message: error.message })
    : copy.fallback;
}
