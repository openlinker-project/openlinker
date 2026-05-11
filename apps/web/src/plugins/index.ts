/**
 * In-Tree Plugin Manifest
 *
 * Single edit point for the in-tree FE platform plugins. Mirrors
 * `apps/api/src/plugins.ts` from #572. To add a third-party platform
 * plugin, add an entry here — no other file in `apps/web/src/{app,features,
 * pages,shared}` should need to change.
 *
 * The order in this array determines the rendering order of
 * platform-driven UI lists (e.g. setup-card sequence on `PlatformPicker`,
 * dropdown option order on connection filters / create-connection form).
 *
 * Duplicate `platformType` keys are rejected at module load time below —
 * the same check also runs inside `PluginRegistryProvider` so fixture
 * plugins injected by tests can't accidentally shadow each other.
 *
 * @module plugins
 */
import type { PlatformPlugin } from '../shared/plugins';
import { prestashopPlugin } from './prestashop/prestashop.plugin';
import { allegroPlugin } from './allegro/allegro.plugin';

const PLUGINS: readonly PlatformPlugin[] = [prestashopPlugin, allegroPlugin];

// Module-load validation: catches the production-manifest case before any
// provider mounts. The provider-level guard in `plugin-registry-context.tsx`
// covers the test-fixture case (where a non-production array is passed in).
function assertUniquePlatformTypes(plugins: readonly PlatformPlugin[]): void {
  const seen = new Set<string>();
  for (const p of plugins) {
    if (seen.has(p.platformType)) {
      throw new Error(
        `Duplicate plugin platformType: "${p.platformType}". Each registered plugin must have a unique \`platformType\`.`,
      );
    }
    seen.add(p.platformType);
  }
}
assertUniquePlatformTypes(PLUGINS);

export const IN_TREE_PLUGINS: readonly PlatformPlugin[] = PLUGINS;
