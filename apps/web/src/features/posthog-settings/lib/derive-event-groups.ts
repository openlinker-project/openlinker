/**
 * Derive Event Groups
 *
 * Extracts the distinct, first-seen-order list of group values from a
 * demo-events-shaped catalog. Generic over the catalog shape (not hard-coded
 * to `DemoEventCatalog`) so the settings panel's group list is always
 * derived from whatever the real catalog contains — never hand-maintained
 * (#1787's core requirement).
 *
 * @module apps/web/src/features/posthog-settings/lib
 */

export function deriveEventGroups<C extends Record<string, { group: string }>>(
  catalog: C
): ReadonlyArray<C[keyof C]['group']> {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const entry of Object.values(catalog)) {
    if (!seen.has(entry.group)) {
      seen.add(entry.group);
      groups.push(entry.group);
    }
  }
  return groups as ReadonlyArray<C[keyof C]['group']>;
}
