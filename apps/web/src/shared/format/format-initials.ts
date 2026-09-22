/**
 * Initials from a display name (#3423/#3427)
 *
 * First-and-last initial, uppercased — the shared `shell-user-chip__avatar`
 * / `lane__avatar` formula, extracted once rather than duplicated per
 * consumer (the bench topbar and the Assign Packing Work lane headers both
 * need it).
 *
 * @module apps/web/src/shared/format
 */
export function formatInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0]?.charAt(0) ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
  return (first + last).toUpperCase();
}
