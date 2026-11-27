/**
 * describePriceChangeActionError (#3148, #3873, #3867)
 *
 * Maps a price-change write failure to operator-facing copy (#3148 review,
 * finding 9). With a 30 s background poll and a per-dialog version
 * snapshot, a stale episode (`PRICE_CHANGE_STALE`) is a ROUTINE outcome, so
 * its copy lives in this feature's `apiErrors`. A block caused by a currency
 * mismatch names the connection setting to fix, which the shared
 * `PRICE_CHANGE_BLOCKED` copy cannot; every other failure reads through
 * `describeApiError`.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { ApiError } from '../../../shared/api/api-error';
import { describeApiError } from '../../../shared/api/describe-api-error';
import { getMessages } from '../../../shared/i18n';

export function describePriceChangeActionError(error: unknown): string {
  if (
    error instanceof ApiError &&
    error.code === 'PRICE_CHANGE_BLOCKED' &&
    error.params.blockReason === 'currency-mismatch'
  ) {
    return getMessages('price-changes').describePriceChangeError.currencyMismatch;
  }
  return describeApiError(error, 'price-changes');
}
