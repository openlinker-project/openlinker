/**
 * AdapterPlugin — framework-neutral plugin contract
 *
 * The minimal surface every per-connection integration plugin implements:
 *
 *   - `manifest`: static `AdapterMetadata` consumed by `AdapterRegistryService`
 *     to answer "what does this adapter do and which platformType does it
 *     handle?" Drives runtime adapter resolution.
 *
 *   - `register?(host)`: imperative side-registrations beyond the base
 *     `manifest` + `createCapabilityAdapter` pair — connection tester,
 *     retry classifier, scheduler tasks, email normalizer, webhook
 *     provisioner. Called exactly once at boot, after the host has bound
 *     `manifest` and the factory. Optional — plugins with no side
 *     registrations can omit it.
 *
 *   - `createCapabilityAdapter`: per-connection capability-adapter factory.
 *     Mirrors `AdapterFactoryPort.createCapabilityAdapter` but uses
 *     `HostServices` as a typed bag in place of positional
 *     `identifierMapping` + `credentialsResolver` arguments — this is
 *     the seam plugin authors implement, and the seam decouples plugins
 *     from the NestJS module composition (#593).
 *
 * Plugin authors export an object literal (or a class) implementing this
 * interface and either:
 *
 *   - hand it to `createNestAdapterModule({ plugin })` for the simple
 *     case (no plugin-specific Nest providers), or
 *
 *   - register it inline from their own NestJS module's `onModuleInit` —
 *     the in-tree Allegro + PrestaShop pattern, used when the plugin needs
 *     its own `@Injectable` providers (repositories, provisioners, …).
 *     See `docs/plans/implementation-plan-adapter-plugin-contract.md`
 *     § 3.4 for the canonical Allegro example.
 *
 * @module libs/plugin-sdk/src
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { HostServices } from './host-services';

export interface AdapterPlugin {
  /**
   * Static metadata. Defines `adapterKey`, `platformType`,
   * `supportedCapabilities`, `displayName`, `version`, `isDefault`.
   * Bound to `AdapterRegistryService` at boot.
   */
  readonly manifest: AdapterMetadata;

  /**
   * Optional side-registrations against host registries beyond the base
   * `manifest` + factory pair. Called exactly once at boot by the host
   * wrapper. The plugin uses `host.connectionTesterRegistry`,
   * `host.emailNormalizerRegistry`, `host.retryClassifierRegistry`,
   * `host.schedulerTaskRegistry`, `host.webhookProvisioningRegistry` —
   * whichever are relevant. Omit if the plugin only registers the base
   * `manifest` + factory.
   */
  register?(host: HostServices): void;

  /**
   * Create a per-connection capability-adapter instance.
   *
   * Called by `AdapterFactoryResolverService.createCapabilityAdapter`
   * indirectly via the host wrapper. The wrapper translates the
   * positional `AdapterFactoryPort` signature into the bag-style
   * `host: HostServices` shape — see
   * `createNestAdapterModule` for the bridge, or
   * `docs/plans/implementation-plan-adapter-plugin-contract.md` § 3.3
   * for the contract.
   *
   * @param connection - The connection this adapter binds to.
   * @param capability - The requested capability (e.g. `'OfferManager'`,
   *   `'OrderSource'`). Must be present in `manifest.supportedCapabilities`
   *   or the plugin should throw.
   * @param host - The curated host-services bag. The `identifierMapping`
   *   and `credentialsResolver` fields carry the per-call values passed
   *   into `AdapterFactoryPort` (today these are the same DI singletons
   *   as the wrapping module sees, but the contract permits a test
   *   harness to override them).
   */
  createCapabilityAdapter<T>(
    connection: Connection,
    capability: string,
    host: HostServices,
  ): Promise<T>;
}
