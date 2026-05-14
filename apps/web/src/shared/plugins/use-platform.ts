/**
 * usePlatform Hook
 *
 * Looks up the registered plugin's platform-side contribution for a given
 * `platformType`. Returns `undefined` for unknown platforms (or plugins
 * that don't contribute platform-side affordances) so consumers can fall
 * through to a generic raw-config rendering path.
 *
 * Renamed from `usePlugin` during the WebPlugin/PlatformPlugin unification
 * (#702) — the return shape is now specifically the platform-side view.
 *
 * @module shared/plugins
 */
import { usePlatforms } from './use-platforms';
import type { Platform } from './plugin.types';

export function usePlatform(platformType: string | undefined): Platform | undefined {
  const platforms = usePlatforms();
  if (!platformType) return undefined;
  return platforms.find((p) => p.platformType === platformType);
}
