/**
 * Authorize error mapping (#2372/#2376, #3083)
 *
 * `ReturnAuthorizeRefusedError` carries exactly one reason —
 * `source-ingested` — which `ReturnsExceptionFilter` emits as a top-level
 * `reason` field, the same convention `readMatchRefusalReason` and
 * `readBlockedTrigger` already read. A source-ingested return should never
 * reach this dialog at all (gated at the worklist level, #3081's own
 * predicate), so this helper exists for defence-in-depth on any OTHER entry
 * point this dialog is later reused from.
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';

/** `true` only for the one refusal `ReturnAuthorizeRefusedError` can carry. */
export function isSourceIngestedAuthorizeRefusal(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return false;
  return (details as { reason: unknown }).reason === 'source-ingested';
}
