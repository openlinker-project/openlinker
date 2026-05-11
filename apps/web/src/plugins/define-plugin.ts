/**
 * definePlugin
 *
 * Identity helper for authoring a `WebPlugin`. Exists purely for type-checked
 * ergonomics — plugin authors get full IntelliSense on the slot shape without
 * having to annotate the export themselves. Mirrors the pattern of Vite's
 * `defineConfig` and similar.
 *
 * @module plugins
 */
import type { WebPlugin } from './plugin.types';

export function definePlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}
