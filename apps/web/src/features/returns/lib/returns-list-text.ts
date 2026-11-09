/**
 * Returns List Text
 *
 * The two returns-list sentences built from numbers, read from the `returns`
 * namespace at call time so a language switch reaches them.
 *
 * @module apps/web/src/features/returns/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';

/**
 * A row this build could not read. Reported next to the range label so the two
 * numbers are read together - the range counts what the server says exists, the
 * rendered rows count what could be shown, and hiding the gap between them
 * would make the shorter list look complete.
 */
export function describeUnreadableRows(count: number): string {
  return formatPlural(count, getMessages('returns').list.unreadableRows, getLocale());
}

export function describeRange(from: number, to: number, total: number): string {
  return interpolate(getMessages('returns').list.range, { from, to, total });
}
