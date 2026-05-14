/**
 * __Name__ Plugin Descriptor
 *
 * Framework-neutral `AdapterPlugin` describing the __Name__ integration.
 * Scaffolded with no capabilities and no side-registrations — this is a
 * starting point. As you implement capabilities, add adapter classes
 * under `infrastructure/adapters/`, wire them into the factory's
 * `createAdapters`, expand `supportedCapabilities` here, and route the
 * adapter through `createCapabilityAdapter` via `dispatchCapability`.
 *
 * See `docs/plugin-author-guide.md` § Step 6 for the full descriptor
 * shape and the `AdapterPlugin` contract spec at
 * `libs/plugin-sdk/src/adapter-plugin.ts:42-110`.
 *
 * @module libs/integrations/__name__/src
 */
import { type AdapterPlugin, type HostServices } from '@openlinker/plugin-sdk';
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';

/**
 * When you wire your first capability adapter through
 * `createCapabilityAdapter` below, import the factory:
 *
 *   import { __Name__AdapterFactory } from './application/__name__-adapter.factory';
 *
 * The factory class itself is already scaffolded under `application/`.
 */

/**
 * Plugin-specific cross-package dependencies passed via factory closure
 * (not through the curated `HostServices` bag). Empty for the scaffold;
 * widen as your plugin grows — see PrestaShop's
 * `CreatePrestashopPluginDeps` for the canonical shape.
 */
export type Create__Name__PluginDeps = Record<string, never>;

/**
 * Static plugin manifest (#575).
 *
 * Exported as a top-level `const` so consumers can read manifest fields
 * without instantiating the full plugin. The runtime path
 * (`create__Name__Plugin({}).manifest`) returns this same reference, so
 * there's no drift between static and runtime views.
 *
 * `supportedCapabilities` starts empty. As you implement capability
 * adapters, add their names here AND extend the dispatch table in
 * `createCapabilityAdapter` below.
 */
export const __camelName__AdapterManifest: AdapterMetadata = {
  adapterKey: '__name__.publicapi.v1',
  platformType: '__name__',
  supportedCapabilities: [],
  displayName: '__Name__',
  version: '0.1.0',
  isDefault: true,
};

/**
 * Short brand label used as the user-facing prefix when this plugin's
 * adapters raise domain exceptions (`InvalidConnectionConfigException`,
 * `InvalidCredentialsShapeException`). Co-located with the manifest so
 * a rebrand touches one line.
 */
const __NAME___BRAND = '__BRAND__';

export function create__Name__Plugin(
  _deps: Create__Name__PluginDeps,
): AdapterPlugin {
  return {
    manifest: __camelName__AdapterManifest,

    // No side-registrations yet. As you add a connection tester, shape
    // validators, webhook provisioner, etc., uncomment and register them
    // here. See the plugin author guide § Step 7 (shape validators) and
    // § Step 8 (credentials / OAuth).
    register(_host: HostServices): void {
      // host.connectionTesterRegistry.register(
      //   __camelName__AdapterManifest.adapterKey,
      //   new __Name__ConnectionTesterAdapter(),
      // );
      // host.connectionConfigShapeValidatorRegistry.register(
      //   __camelName__AdapterManifest.adapterKey,
      //   new __Name__ConnectionConfigShapeValidatorAdapter(__NAME___BRAND),
      // );
    },

    createCapabilityAdapter<T>(
      _connection: Connection,
      capability: string,
      _host: HostServices,
    ): Promise<T> {
      // Once you implement capability adapters, swap this for a
      // `dispatchCapability<T>(capability, { ... }, BRAND)` call — see
      // PrestaShop and Allegro plugin descriptors for the canonical shape.
      return Promise.reject(
        new Error(
          `${__NAME___BRAND} adapter does not yet implement any capabilities. ` +
            `Requested: "${capability}". ` +
            `See docs/plugin-author-guide.md § Step 4 for how to implement one.`,
        ),
      );
    },
  };
}
