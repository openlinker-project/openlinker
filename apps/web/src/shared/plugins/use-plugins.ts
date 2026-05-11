/**
 * usePlugins Hook
 *
 * Returns the full in-tree platform plugin manifest. Throws if used outside
 * a `<PluginRegistryProvider>` — every render path in `apps/web` is mounted
 * inside the provider in `AppProviders`, so a missing provider indicates a
 * misconfigured test, not a runtime branch.
 *
 * @module shared/plugins
 */
import { useContext } from 'react';
import { PluginRegistryContext } from './plugin-registry-context';
import type { PlatformPlugin } from './plugin.types';

export function usePlugins(): readonly PlatformPlugin[] {
  const ctx = useContext(PluginRegistryContext);
  if (ctx === null) {
    throw new Error('usePlugins() must be used inside <PluginRegistryProvider>.');
  }
  return ctx;
}
