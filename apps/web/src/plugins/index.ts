/**
 * Plugin registry — single edit point
 *
 * Lists every in-tree plugin the FE host should compose. Two parallel
 * concerns live here, both intentionally surfaced from one barrel so
 * adding a new platform is a single edit point:
 *
 * 1. **Build-time host composition** (`plugins`, `WebPlugin`, #604/#605) —
 *    routes, nav items, typed API client namespaces. Iterated at
 *    `createApiClient` / router setup time. **Both runtime composition
 *    AND TS declaration-merging require the plugin to be in the `plugins`
 *    array.** Each plugin's `declare module '../../app/api/api-client'`
 *    block is only picked up by the compiler when the plugin file is in
 *    the import graph — and the only path that puts it there is being
 *    referenced from this barrel.
 *
 * 2. **Runtime per-platform UI** (`IN_TREE_PLUGINS`, `PlatformPlugin`,
 *    #578/#579) — setup cards, structured edit-form sections, extra
 *    sections, connection actions, credentials panels. Resolved via
 *    React context (`usePlugin(platformType)` / `usePlugins()`).
 *
 * The two concepts are kept separate (different shapes, different
 * resolution times) but contributed from the same per-platform directory
 * so the "one plugin → one folder" mental model holds.
 *
 * Mirrors `apps/api/src/plugins.ts` (BE counterpart, #572).
 *
 * @module plugins
 */
import { allegroPlugin } from './allegro';
import { allegroPlatformPlugin } from './allegro/allegro.plugin';
import { assertUniquePluginIds } from './assert-unique-plugin-ids';
import { prestashopPlugin } from './prestashop';
import { prestashopPlatformPlugin } from './prestashop/prestashop.plugin';
import type { WebPlugin } from './plugin.types';
import type { PlatformPlugin } from '../shared/plugins';

export const plugins: WebPlugin[] = [allegroPlugin, prestashopPlugin];

assertUniquePluginIds(plugins);

/**
 * Runtime platform-plugin manifest (#578/#579). Iteration order drives
 * platform-driven UI lists (setup-card sequence on `PlatformPicker`,
 * dropdown option order on connection filters / create-connection form).
 *
 * Module-load validation rejects duplicate `platformType` keys before
 * any provider mounts; `PluginRegistryProvider` re-runs the same check
 * at mount time as belt-and-suspenders for test fixtures.
 */
const PLATFORM_PLUGINS: readonly PlatformPlugin[] = [
  prestashopPlatformPlugin,
  allegroPlatformPlugin,
];

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
assertUniquePlatformTypes(PLATFORM_PLUGINS);

export const IN_TREE_PLUGINS: readonly PlatformPlugin[] = PLATFORM_PLUGINS;
