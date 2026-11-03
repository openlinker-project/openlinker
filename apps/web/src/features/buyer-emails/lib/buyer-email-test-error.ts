/**
 * Buyer Email Test Send Error (#3555)
 *
 * `POST /buyer-emails/test` answers a rate-limited send with 429 and a
 * machine-readable `error` code. The editor branches on the code, never on the
 * message, which the backend is free to reword.
 *
 * Mirrors `BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE` in
 * `apps/api/src/orders/http/buyer-emails.controller.ts` verbatim - the
 * browser bundle cannot import backend code (#591).
 *
 * @module apps/web/src/features/buyer-emails/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE = 'BUYER_EMAIL_TEST_RATE_LIMITED';

export function isBuyerEmailTestRateLimitedError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 429) return false;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return false;
  return (details as { error?: unknown }).error === BUYER_EMAIL_TEST_RATE_LIMITED_ERROR_CODE;
}
