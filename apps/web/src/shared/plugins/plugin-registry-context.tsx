/**
 * Plugin Registry Context
 *
 * React context exposing the in-tree platform manifest to any component
 * below the provider. Consumers should use `usePlatforms()` or
 * `usePlatform(platformType)` from the sibling hook files rather than
 * reading the context directly.
 *
 * The provider accepts the unified `OpenLinkerPlugin[]` registry and
 * pre-flattens it to a `Platform[]` view (one allocation per provider
 * mount, not per hook call). Plugins that don't contribute platform-side
 * affordances are filtered out — runtime consumers never see them.
 *
 * @module shared/plugins
 */
import { createContext, useMemo, type PropsWithChildren, type ReactElement } from 'react';
import type { OpenLinkerPlugin, Platform } from './plugin.types';

export const PluginRegistryContext = createContext<readonly Platform[] | null>(null);

interface PluginRegistryProviderProps {
  plugins: readonly OpenLinkerPlugin[];
}

export function PluginRegistryProvider({
  plugins,
  children,
}: PropsWithChildren<PluginRegistryProviderProps>): ReactElement {
  // Flatten + validate at mount. The production manifest is also validated
  // at module load in `apps/web/src/plugins/index.ts`; this guard is the
  // belt-and-suspenders for test fixtures that pass in their own arrays.
  // Plugin lookup uses `Array.find` — without this check a duplicate
  // `platformType` would shadow its sibling at runtime.
  const platforms = useMemo<readonly Platform[]>(() => {
    const seen = new Set<string>();
    const view: Platform[] = [];
    for (const p of plugins) {
      if (p.platform === undefined) continue;
      if (p.platformType === undefined) {
        throw new Error(
          `Plugin "${p.id}" contributes a \`platform\` bag but is missing the required top-level \`platformType\`.`,
        );
      }
      if (seen.has(p.platformType)) {
        throw new Error(
          `Duplicate plugin platformType: "${p.platformType}". Each plugin that contributes platform-side affordances must have a unique \`platformType\`.`,
        );
      }
      seen.add(p.platformType);
      view.push({ platformType: p.platformType, ...p.platform });
    }
    return view;
  }, [plugins]);

  return (
    <PluginRegistryContext.Provider value={platforms}>{children}</PluginRegistryContext.Provider>
  );
}
