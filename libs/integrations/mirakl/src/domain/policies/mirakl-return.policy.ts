/**
 * Mirakl Return Policy
 *
 * Which RT11 states end a return, and the feed event key (#4279).
 *
 * Terminal: `CLOSED` (handled), `REFUSED` (the seller declined it) and
 * `CANCELED`. Mirakl's documentation names no terminal set, so the list is
 * deliberately narrow: `NO_RECEPTION` (the parcel never arrived) and
 * `RECEIVED` can still move on, so they keep being re-read. A state the list
 * misses only costs re-reads, bounded by the status sync's age window.
 *
 * Terminal at source bounds the re-read sweep; it never decides anything in
 * OpenLinker (ADR-060).
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */

export const TERMINAL_RETURN_STATES: readonly string[] = ['CLOSED', 'REFUSED', 'CANCELED'];

export function isTerminalReturnState(state: string | undefined): boolean {
  return state !== undefined && TERMINAL_RETURN_STATES.includes(state);
}

/** One event per change: the same return updated twice is two events. */
export function buildReturnEventKey(returnId: string, lastUpdated: string | undefined): string {
  return `${returnId}:${lastUpdated ?? 'unknown'}`;
}
