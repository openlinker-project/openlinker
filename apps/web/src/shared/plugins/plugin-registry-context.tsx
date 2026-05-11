/**
 * Plugin Registry Context
 *
 * React context that exposes the in-tree platform plugin manifest to any
 * component below the provider. Consumers should use `usePlugins()` or
 * `usePlugin(platformType)` from the sibling hook files rather than reading
 * the context directly.
 *
 * @module shared/plugins
 */
import { createContext, useMemo, type PropsWithChildren, type ReactElement } from 'react';
import type { PlatformPlugin } from './plugin.types';

export const PluginRegistryContext = createContext<readonly PlatformPlugin[] | null>(null);

interface PluginRegistryProviderProps {
  plugins: readonly PlatformPlugin[];
}

export function PluginRegistryProvider({
  plugins,
  children,
}: PropsWithChildren<PluginRegistryProviderProps>): ReactElement {
  // Fail fast on duplicate `platformType` keys when the provider mounts.
  // The production manifest is validated at module load in
  // `apps/web/src/plugins/index.ts`; this guard is the belt-and-suspenders
  // for test fixtures that pass in their own plugin arrays. Plugin lookup
  // uses `Array.find`, which silently returns the first match — without
  // this check a duplicate would shadow its sibling at runtime.
  useMemo(() => {
    const seen = new Set<string>();
    for (const p of plugins) {
      if (seen.has(p.platformType)) {
        throw new Error(
          `Duplicate plugin platformType: "${p.platformType}". Each registered plugin must have a unique \`platformType\`.`,
        );
      }
      seen.add(p.platformType);
    }
  }, [plugins]);

  return (
    <PluginRegistryContext.Provider value={plugins}>{children}</PluginRegistryContext.Provider>
  );
}
