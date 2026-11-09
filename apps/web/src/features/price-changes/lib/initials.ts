/**
 * Avatar initials (#3148, #3873)
 *
 * The two-letter initials shown in a product avatar chip.
 *
 * @module apps/web/src/features/price-changes/lib
 */

/**
 * Two-letter initials for an avatar chip (#3148 review, finding 8). Filters
 * empty tokens first, since a name with a leading/doubled space otherwise
 * produces an empty-string initial and silently renders a blank chip.
 */
export function initialsFor(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
