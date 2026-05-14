/**
 * definePlugin
 *
 * Identity helper for authoring an `OpenLinkerPlugin`. Exists purely for
 * type-checked ergonomics — plugin authors get full IntelliSense on the
 * slot shape without having to annotate the export themselves. Mirrors
 * the pattern of Vite's `defineConfig` and similar.
 *
 * @module plugins
 */
import type { OpenLinkerPlugin } from '../shared/plugins';

export function definePlugin(plugin: OpenLinkerPlugin): OpenLinkerPlugin {
  return plugin;
}
