/**
 * usePlatforms Hook
 *
 * Returns the flattened platform manifest — one entry per registered plugin
 * that contributes platform-side affordances (`platform` bag set). Plugins
 * that only contribute build-time concerns are filtered out at the provider
 * layer.
 *
 * Throws if used outside a `<PluginRegistryProvider>` — every render path
 * in `apps/web` is mounted inside the provider in `AppProviders`, so a
 * missing provider indicates a misconfigured test, not a runtime branch.
 *
 * Renamed from `usePlugins` during the WebPlugin/PlatformPlugin
 * unification (#702).
 *
 * @module shared/plugins
 */
import { useContext } from 'react';
import { PluginRegistryContext } from './plugin-registry-context';
import type { Platform } from './plugin.types';

export function usePlatforms(): readonly Platform[] {
  const ctx = useContext(PluginRegistryContext);
  if (ctx === null) {
    throw new Error('usePlatforms() must be used inside <PluginRegistryProvider>.');
  }
  return ctx;
}
