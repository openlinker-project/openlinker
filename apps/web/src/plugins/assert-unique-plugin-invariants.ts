/**
 * assertUniquePluginInvariants
 *
 * Boot-time invariants on the in-tree plugin registry (#702):
 *   1. `id` is unique across every plugin
 *   2. Every plugin contributing a `platform` bag declares a `platformType`
 *   3. `platformType` is unique among plugins that declare one
 *   4. `connectionConfig.schemaShape` field names are unique across plugins
 *      (#1330) - the fields land in the single flat
 *      `PluginEditConnectionFields` interface, and TS silently accepts
 *      same-type declaration merges, so two plugins declaring e.g.
 *      `sellerNip` would collide without any compile-time signal
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
  const connectionFieldOwners = new Map<string, string>();
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

    const schemaShape = plugin.platform?.connectionConfig?.schemaShape;
    if (schemaShape !== undefined) {
      for (const fieldName of Object.keys(schemaShape)) {
        const owner = connectionFieldOwners.get(fieldName);
        if (owner !== undefined) {
          throw new Error(
            `Duplicate connection-config field name: "${fieldName}" is contributed by both plugin "${owner}" and plugin "${plugin.id}". Field names merged into PluginEditConnectionFields must be unique across plugins - prefix them with the platform (e.g. "ksefEnvironment").`,
          );
        }
        connectionFieldOwners.set(fieldName, plugin.id);
      }
    }
  }
}
