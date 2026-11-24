/**
 * Return Detail Text
 *
 * The two derived sentences the return detail builds from a line's counters.
 * They read `getMessages('returns')` at call time, so the active language is
 * the one in force when the sentence is rendered (ADR-081).
 *
 * @module apps/web/src/features/returns/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';

/** A line this build could not read. Reported, never quietly dropped. */
export function describeUnreadableLines(count: number): string {
  return formatPlural(count, getMessages('returns').detail.lines.unreadableLines, getLocale());
}

/**
 * The quantity summary for one line.
 *
 * Derived purely from the counters, and worded so it cannot be mistaken for a
 * state OpenLinker tracks: nothing has arrived until `received` moves.
 */
export function describeLineQuantity(advised: number, received: number): string {
  const copy = getMessages('returns').detail.lines;
  return received === 0
    ? interpolate(copy.advisedOnly, { advised })
    : interpolate(copy.receivedOfAdvised, { received, advised });
}
