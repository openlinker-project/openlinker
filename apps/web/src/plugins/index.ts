/**
 * Plugin registry — single edit point
 *
 * Lists every in-tree plugin the FE host should compose. To enable a new
 * plugin, drop a directory under `apps/web/src/plugins/<name>/` exporting
 * a `WebPlugin` (built via `definePlugin({...})`) and append it here.
 *
 * Mirrors `apps/api/src/plugins.ts` (BE counterpart, #572). Same intent:
 * the OSS contributor never has to edit core composition files.
 *
 * @module plugins
 */
import { allegroPlugin } from './allegro';
import { prestashopPlugin } from './prestashop';
import type { WebPlugin } from './plugin.types';

export const plugins: WebPlugin[] = [allegroPlugin, prestashopPlugin];

// Boot-time invariant: plugin ids must be unique. Catches forks/copies that
// forget to rename. Runs once at module load — empty static array passes,
// duplicates fail loudly in dev + CI.
const seen = new Set<string>();
for (const plugin of plugins) {
  if (seen.has(plugin.id)) {
    throw new Error(`Duplicate plugin id: "${plugin.id}". Plugin ids must be unique.`);
  }
  seen.add(plugin.id);
}
