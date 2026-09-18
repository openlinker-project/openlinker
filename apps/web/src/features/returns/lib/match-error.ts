/**
 * Match-to-order error mapping (#2372/#2376, #3082)
 *
 * Turns a failed `POST /returns/:returnId/match-order` into an operator
 * sentence — the `decline-error.ts` precedent, applied to a different
 * refusal union.
 *
 * **It reads the response body's `reason` field, never the message
 * string.** `ReturnsExceptionFilter` emits `reason` as a top-level field for
 * exactly this exception (`ReturnMatchRefusedError`) so a client branches on
 * the vocabulary rather than a sentence that will be reworded — the same rule
 * `readBlockedTrigger` states for `ReturnNotAttributedError.trigger`.
 *
 * `already-attributed` is CONFLICT (409): the return's own state refuses.
 * `unknown-order` is BAD REQUEST (400): the id the operator supplied names
 * nothing OpenLinker minted — the fix is in what was typed, which is why it
 * renders as a FIELD error naming that value, never a generic toast.
 *
 * **`readMatchRefusalReason` deliberately never consults `error.status`.**
 * The status pairing above is what the backend does today, but `reason` is
 * the guaranteed discriminator — the same rule `readBlockedTrigger` follows
 * for `ReturnNotAttributedError.trigger` — so this function degrades
 * gracefully if that status mapping is ever revised, rather than requiring
 * both fields to agree (tech-lead review on #3281, SUGGESTION).
 *
 * @module apps/web/src/features/returns/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export const MATCH_RETURN_REFUSAL_REASON_VALUES = ['already-attributed', 'unknown-order'] as const;
export type MatchReturnRefusalReason = (typeof MATCH_RETURN_REFUSAL_REASON_VALUES)[number];

/**
 * Returns `null` for anything that is not one of the two reasons this build
 * recognises, so an error shape this build predates degrades to the generic
 * message rather than rendering `undefined`.
 */
export function readMatchRefusalReason(error: unknown): MatchReturnRefusalReason | null {
  if (!(error instanceof ApiError)) return null;
  const details: unknown = error.details;
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const reason: unknown = (details as { reason: unknown }).reason;
  return (MATCH_RETURN_REFUSAL_REASON_VALUES as readonly string[]).includes(reason as string)
    ? (reason as MatchReturnRefusalReason)
    : null;
}
