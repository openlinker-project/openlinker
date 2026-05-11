/**
 * assertUniquePluginIds
 *
 * Boot-time invariant: plugin ids must be unique across the registry.
 * Extracted as a pure helper so the failure path is exercisable from
 * tests without dynamic-import gymnastics — the barrel calls it at
 * module load with the static `plugins` array.
 *
 * @module plugins
 */
import type { WebPlugin } from './plugin.types';

export function assertUniquePluginIds(plugins: readonly WebPlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) {
      const duplicateIds = plugins
        .filter((p) => p.id === plugin.id)
        .map((_, i) => `plugins[${i}]`)
        .join(', ');
      throw new Error(
        `Duplicate plugin id: "${plugin.id}" appears multiple times in the registry (${duplicateIds}). Plugin ids must be unique.`,
      );
    }
    seen.add(plugin.id);
  }
}
