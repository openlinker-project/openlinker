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

  /**
   * Optional. TypeORM migration glob paths the plugin ships (#599).
   *
   * Declares the SQL/DDL the plugin needs to add to the host's schema.
   * Each entry is a glob the TypeORM CLI can expand — typically
   * `path.resolve(__dirname, 'migrations/**\/*{.ts,.js}')` from the
   * plugin's own bootstrap, pointing at `src/migrations/` in dev and
   * `dist/migrations/` in built output via the `{.ts,.js}` alternation.
   *
   * **This field is informational only.** TypeORM CLI does not read plugin
   * descriptors — it reads `apps/api/src/database/data-source.ts`, which
   * aggregates the host's `apps/api/src/plugin-migrations.ts` list (the
   * canonical source). A plugin in `plugins.ts` whose migration globs are
   * NOT also in `plugin-migrations.ts` will boot, register its adapter,
   * and then crash on the first attempt to use its tables with
   * `relation "..." does not exist`. Keep the descriptor field aligned
   * with the host list — the descriptor advertises what the plugin owns,
   * the host list enables it.
   */
  readonly migrations?: readonly string[];
}
