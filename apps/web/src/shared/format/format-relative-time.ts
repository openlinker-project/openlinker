/**
 * Format Relative Time
 *
 * Converts an ISO 8601 timestamp to a human-readable relative time string
 * (e.g., "just now", "5m ago", "2h ago", "3d ago"). Useful for displaying
 * recency in data tables and status displays.
 *
 * @module apps/web/src/shared/format
 */

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
