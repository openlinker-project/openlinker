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
 * @module plugins
 */
import type { PlatformPlugin } from '../shared/plugins';
import { prestashopPlugin } from './prestashop/prestashop.plugin';
import { allegroPlugin } from './allegro/allegro.plugin';

export const IN_TREE_PLUGINS: readonly PlatformPlugin[] = [prestashopPlugin, allegroPlugin];
