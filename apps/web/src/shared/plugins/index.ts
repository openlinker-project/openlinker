/**
 * Plugin Registry Public Surface
 *
 * Re-exports the registry contract (types, provider, hooks) consumed by
 * features, pages, and the app composition root. The actual plugin
 * instances live in `apps/web/src/plugins/` and are wired into the
 * provider via `IN_TREE_PLUGINS` in `apps/web/src/plugins/index.ts`.
 *
 * @module shared/plugins
 */
export type {
  PlatformPlugin,
  PlatformSetupCard,
  StructuredConfigSectionProps,
  ExtraConfigSectionProps,
} from './plugin.types';
export { PluginRegistryProvider, PluginRegistryContext } from './plugin-registry-context';
export { usePlugins } from './use-plugins';
export { usePlugin } from './use-plugin';
