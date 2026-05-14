/**
 * assertUniquePluginInvariants
 *
 * Boot-time invariants on the in-tree plugin registry (#702):
 *   1. `id` is unique across every plugin
 *   2. Every plugin contributing a `platform` bag declares a `platformType`
 *   3. `platformType` is unique among plugins that declare one
 *
 * Extracted as a pure helper so the failure paths are exercisable from
 * tests without dynamic-import gymnastics — the barrel calls it at
 * module load with the static `plugins` array.
 *
 * @module plugins
 */
import type { OpenLinkerPlugin } from '../shared/plugins';

export function assertUniquePluginInvariants(plugins: readonly OpenLinkerPlugin[]): void {
  const idSeen = new Set<string>();
  const platformTypeSeen = new Set<string>();
  for (const plugin of plugins) {
    if (idSeen.has(plugin.id)) {
      const duplicateIds = plugins
        .filter((p) => p.id === plugin.id)
        .map((_, i) => `plugins[${i}]`)
        .join(', ');
      throw new Error(
        `Duplicate plugin id: "${plugin.id}" appears multiple times in the registry (${duplicateIds}). Plugin ids must be unique.`,
      );
    }
    idSeen.add(plugin.id);

    if (plugin.platform !== undefined) {
      if (plugin.platformType === undefined) {
        throw new Error(
          `Plugin "${plugin.id}" contributes a \`platform\` bag but is missing the required top-level \`platformType\`.`,
        );
      }
      if (platformTypeSeen.has(plugin.platformType)) {
        throw new Error(
          `Duplicate plugin platformType: "${plugin.platformType}". Each plugin that contributes platform-side affordances must have a unique \`platformType\`.`,
        );
      }
      platformTypeSeen.add(plugin.platformType);
    }
  }
}
