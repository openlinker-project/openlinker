/**
 * Label getters
 *
 * Builds a `Record<Key, string>` whose every value is a getter reading the
 * active language's copy at the moment it is read (ADR-081). Lets the
 * exported label maps keep their name and shape for callers while never
 * freezing the language that happened to be active at module load.
 *
 * @module apps/web/src/features/shipments/lib
 */
export function labelGetters<K extends string>(
  keys: readonly K[],
  read: () => Readonly<Record<K, string>>,
): Record<K, string> {
  const map = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(map, key, { enumerable: true, get: () => read()[key] });
  }
  return map;
}
