/**
 * Plugin registry — single edit point
 *
 * Lists every in-tree plugin the FE host composes. Each plugin is a single
 * `OpenLinkerPlugin` object (#702) contributing both its build-time bag
 * (`build`: routes, nav items, API namespaces, offer-creation wizard) and
 * its platform-side bag (`platform`: setup card, edit-form sections,
 * credentials panel, content publish-error extractor). Adding a new
 * in-tree platform means dropping a folder under `plugins/<name>/` and
 * appending one entry to the array below.
 *
 * **Both runtime composition AND TS declaration-merging require the
 * plugin to be in this array.** Each plugin's
 * `declare module '../../app/api/api-client'` block is only picked up by
 * the compiler when the plugin file is in the import graph — and the only
 * path that puts it there is being referenced from this barrel.
 *
 * Iteration order drives:
 *   - Build-time: route registration order (rarely collides), nav-merge
 *     order, API-namespace fold (last wins on key collision).
 *   - Runtime: platform-driven UI lists (setup-card sequence on
 *     `PlatformPicker`, dropdown options on connection filters /
 *     create-connection form). Order chosen here is PS-first, Allegro-
 *     second to match the pre-#702 `IN_TREE_PLUGINS` ordering operators
 *     are used to.
 *
 * **Convention for in-tree plugins**: `id` and `platformType` are kept
 * equal (`id: 'allegro'`, `platformType: 'allegro'`). Architecturally
 * they're distinct concepts — `id` is the build-time uniqueness key,
 * `platformType` is the runtime lookup key matching
 * `connection.platformType` — but keeping them in lockstep makes
 * operator mental models simpler ("one name per plugin"). The runtime
 * guards in `assertUniquePluginInvariants` enforce uniqueness within
 * each keyspace but do NOT enforce equality between them; a future
 * third-party plugin could legitimately set them differently if its
 * platform-name and package-name diverge.
 *
 * Mirrors `apps/api/src/plugins.ts` (BE counterpart, #572).
 *
 * @module plugins
 */
import type { OpenLinkerPlugin } from '../shared/plugins';
import { allegroPlugin } from './allegro';
import { assertUniquePluginInvariants } from './assert-unique-plugin-invariants';
import { prestashopPlugin } from './prestashop';

export const plugins: readonly OpenLinkerPlugin[] = [prestashopPlugin, allegroPlugin];

assertUniquePluginInvariants(plugins);
