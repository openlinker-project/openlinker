/**
 * usePlugin Hook
 *
 * Looks up the registered plugin for a given `platformType`. Returns
 * `undefined` for unknown platforms so consumers can fall through to a
 * generic raw-config rendering path.
 *
 * @module shared/plugins
 */
import { usePlugins } from './use-plugins';
import type { PlatformPlugin } from './plugin.types';

export function usePlugin(platformType: string | undefined): PlatformPlugin | undefined {
  const plugins = usePlugins();
  if (!platformType) return undefined;
  return plugins.find((p) => p.platformType === platformType);
}
