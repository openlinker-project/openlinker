/**
 * Plugin registry — single edit point
 *
 * Lists every in-tree plugin the FE host should compose. To enable a new
 * plugin, drop a directory under `apps/web/src/plugins/<name>/` exporting
 * a `WebPlugin` (built via `definePlugin({...})`) and append it here.
 *
 * **Both runtime composition AND TS declaration-merging require the plugin
 * to be in this array.** Each plugin's `declare module '../../app/api/api-client'`
 * block is only picked up by the compiler when the plugin file is in the
 * import graph — and the only path that puts it there is being referenced
 * from this barrel. A plugin that exists on disk but isn't listed here
 * contributes nothing at runtime AND its type augmentation silently has
 * no effect at compile time. There is no warning for this; assume your
 * augmented `apiClient.<plugin>` field is missing if you forgot the entry.
 *
 * Mirrors `apps/api/src/plugins.ts` (BE counterpart, #572). Same intent:
 * the OSS contributor never has to edit core composition files.
 *
 * @module plugins
 */
import { allegroPlugin } from './allegro';
import { assertUniquePluginIds } from './assert-unique-plugin-ids';
import { prestashopPlugin } from './prestashop';
import type { WebPlugin } from './plugin.types';

export const plugins: WebPlugin[] = [allegroPlugin, prestashopPlugin];

assertUniquePluginIds(plugins);
