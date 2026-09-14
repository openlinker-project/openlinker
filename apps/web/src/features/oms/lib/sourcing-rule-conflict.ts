/**
 * Sourcing-rule refusal reader (#3056)
 *
 * The admin surface answers 409 for two materially different facts, and only
 * one of them carries machine-readable fields:
 *
 *   - **Reorder mismatch** — the id list did not name exactly the active rules.
 *     `RoutingRuleReorderMismatchError` emits `missingRuleIds` and
 *     `unknownRuleIds` as FIELDS rather than folding them into the message,
 *     precisely so a client can correct the list; a client parsing them out of
 *     prose breaks on the first reword. Nothing was written.
 *   - **Duplicate live rule** — a live rule already claims this `(kind, name)`,
 *     or reviving a retired rule would collide with its live replacement. A
 *     plain `ConflictException(message)` with no fields.
 *
 * Both are surfaced, never retried: re-sending the identical request fails
 * identically. The distinction the caller acts on is whether it has ids to work
 * with, which is why `missingRuleIds` / `unknownRuleIds` are `null` (absent)
 * rather than `[]` (present and empty) for a non-reorder conflict.
 *
 * ## The server's own message is used verbatim
 *
 * Both messages name the specific problem, and a generic replacement would be
 * strictly worse than an answer the server already gave.
 *
 * @module apps/web/src/features/oms/lib
 */
import { ApiError } from '../../../shared/api/api-error';

export interface SourcingRuleConflict {
  /** Operator-facing sentence — the server's own. */
  message: string;
  /**
   * Rules the reorder failed to name. `null` when the 409 was not a reorder
   * mismatch, which is a different fact from "named everything".
   */
  missingRuleIds: string[] | null;
  /** Ids the reorder named that are not live rules here. `null` as above. */
  unknownRuleIds: string[] | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * `null` unless every element is a string — a partially-typed array is treated
 * as absent rather than silently filtered, since a truncated id list would send
 * the operator to correct the wrong rules.
 */
function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === 'string') ? [...value] : null;
}

/**
 * Classify a failed sourcing-rule write.
 *
 * Returns `null` for anything that is not a 409 — the caller falls through to
 * its ordinary error handling.
 */
export function readSourcingRuleConflict(error: unknown): SourcingRuleConflict | null {
  if (!(error instanceof ApiError) || !error.isConflict()) return null;

  const details = readRecord(error.details);
  return {
    message: error.message,
    missingRuleIds: readStringArray(details?.['missingRuleIds']),
    unknownRuleIds: readStringArray(details?.['unknownRuleIds']),
  };
}

/**
 * Operator sentence for a failed sourcing-rule write.
 *
 * A 400 gets the server's message verbatim: this endpoint's 400s name the
 * problem precisely — not an OMS connection, a kind/name pair the router cannot
 * evaluate, `priorityLocationIds` on a non-priority rule, an unknown location
 * id, a window that closes before it opens, or an attempt to edit a rule stored
 * as `recognised: false`. Every one of those is something an operator can act
 * on, and a generic sentence would throw it away.
 */
export function describeSourcingRuleError(error: unknown, fallback: string): string {
  const conflict = readSourcingRuleConflict(error);
  if (conflict) return conflict.message;
  if (error instanceof ApiError && error.status === 400 && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof ApiError && error.isForbidden()) {
    return 'You do not have permission to change sourcing rules.';
  }
  if (error instanceof ApiError && error.isNotFound()) {
    return 'This sourcing rule no longer exists.';
  }
  return fallback;
}
