/**
 * Date Formatters
 *
 * Centralised date/time formatting utilities. All functions use the browser's
 * locale so output respects the user's regional settings.
 *
 * @module apps/web/src/shared/format
 * @see {@link formatRelativeTime} for relative ("5m ago") formatting
 */

export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
