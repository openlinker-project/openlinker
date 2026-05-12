/**
 * createNestAdapterModule — NestJS bridge for an AdapterPlugin descriptor
 *
 * Produces a `DynamicModule` that:
 *   - Imports `IntegrationsModule` + `SyncModule` so all registry tokens
 *     resolve (plus any caller-supplied extras).
 *   - Wires the host's curated services out of DI into a `HostServices`
 *     bag (`logger`, `identifierMapping`, `credentialsResolver`, `cache`,
 *     plus the 7 registry handles).
 *   - Calls `adapterRegistry.register(plugin.manifest)`.
 *   - Binds the plugin's `createCapabilityAdapter` into
 *     `AdapterFactoryResolverService` via a thin shim that translates the
 *     existing positional `AdapterFactoryPort` signature into the bag-style
 *     `host: HostServices` shape.
 *   - Calls `plugin.register?.(host)` for side-registrations.
 *
 * Usage scope: this helper is the *simple* path. Plugins that only need
 * services from the curated `HostServices` bag (logger, identifier mapping,
 * credentials, cache) can hand a descriptor here and be done. Plugins that
 * also need their own NestJS providers (a TypeORM repository, an injectable
 * provisioner, …) keep their own `@Module` shape and register the descriptor
 * inline from `onModuleInit` — see the in-tree Allegro + PrestaShop modules
 * for the canonical pattern.
 *
 * Returns `DynamicModule` to match the existing `AiIntegrationModule.register()`
 * pattern at `libs/integrations/ai/src/ai-integration.module.ts:55`.
 *
 * @module libs/plugin-sdk/src
 */
import {
  DynamicModule,
  Module,
  Inject,
  Optional,
  OnModuleInit,
  Provider,
} from '@nestjs/common';
import {
  IntegrationsModule,
  ADAPTER_REGISTRY_TOKEN,
  AdapterRegistryPort,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  AdapterFactoryResolverService,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  ConnectionTesterRegistryService,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  EmailNormalizerRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  WebhookProvisioningRegistryService,
  CREDENTIALS_RESOLVER_TOKEN,
  CredentialsResolverPort,
  AdapterFactoryPort,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  SyncModule,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  RetryClassifierRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
  SchedulerTaskRegistryService,
} from '@openlinker/core/sync';
import {
  IDENTIFIER_MAPPING_PORT_TOKEN,
  IdentifierMappingPort,
  IdentifierMappingModule,
} from '@openlinker/core/identifier-mapping';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';
import type { AdapterPlugin } from './adapter-plugin';
import type { HostServices } from './host-services';

export interface CreateNestAdapterModuleOptions {
  /** The plugin descriptor. */
  readonly plugin: AdapterPlugin;

  /**
   * Extra NestJS imports the plugin's own infrastructure needs.
   * Composed verbatim into the generated module's `imports`.
   */
  readonly imports?: NonNullable<DynamicModule['imports']>;

  /** Extra NestJS providers. Composed verbatim. */
  readonly providers?: Provider[];

  /** Extra NestJS exports. */
  readonly exports?: NonNullable<DynamicModule['exports']>;
}

export function createNestAdapterModule(
  options: CreateNestAdapterModuleOptions,
): DynamicModule {
  const { plugin, imports = [], providers = [], exports: extraExports = [] } = options;

  @Module({})
  class PluginHostModule implements OnModuleInit {
    private readonly logger = new Logger(
      `PluginHost:${plugin.manifest.adapterKey}`,
    );

    constructor(
      @Inject(ADAPTER_REGISTRY_TOKEN)
      private readonly adapterRegistry: AdapterRegistryPort,
      @Inject(ADAPTER_FACTORY_RESOLVER_TOKEN)
      private readonly factoryResolver: AdapterFactoryResolverService,
      @Inject(CONNECTION_TESTER_REGISTRY_TOKEN)
      private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
      @Inject(EMAIL_NORMALIZER_REGISTRY_TOKEN)
      private readonly emailNormalizerRegistry: EmailNormalizerRegistryService,
      @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
      private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
      @Inject(RETRY_CLASSIFIER_REGISTRY_TOKEN)
      private readonly retryClassifierRegistry: RetryClassifierRegistryService,
      @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
      private readonly schedulerTaskRegistry: SchedulerTaskRegistryService,
      @Inject(IDENTIFIER_MAPPING_PORT_TOKEN)
      private readonly identifierMapping: IdentifierMappingPort,
      @Inject(CREDENTIALS_RESOLVER_TOKEN)
      private readonly credentialsResolver: CredentialsResolverPort,
      @Optional()
      @Inject(CACHE_PORT_TOKEN)
      private readonly cache?: CachePort,
    ) {}

    onModuleInit(): void {
      this.logger.log(
        `Registering plugin: ${plugin.manifest.adapterKey} (${plugin.manifest.platformType})`,
      );

      const host: HostServices = {
        logger: (context: string) => new Logger(context),
        identifierMapping: this.identifierMapping,
        credentialsResolver: this.credentialsResolver,
        cache: this.cache,
        adapterRegistry: this.adapterRegistry,
        factoryResolver: this.factoryResolver,
        connectionTesterRegistry: this.connectionTesterRegistry,
        emailNormalizerRegistry: this.emailNormalizerRegistry,
        retryClassifierRegistry: this.retryClassifierRegistry,
        schedulerTaskRegistry: this.schedulerTaskRegistry,
        webhookProvisioningRegistry: this.webhookProvisioningRegistry,
      };

      host.adapterRegistry.register(plugin.manifest);

      const factoryAdapter: AdapterFactoryPort = {
        createCapabilityAdapter: <T>(
          conn: Connection,
          cap: string,
          idMap: IdentifierMappingPort,
          credRes: CredentialsResolverPort,
        ): Promise<T> =>
          plugin.createCapabilityAdapter<T>(conn, cap, {
            ...host,
            // Per-call overrides. AdapterFactoryPort declares identifierMapping
            // and credentialsResolver as positional per-call args. Today they
            // come from the same DI singletons as host.identifierMapping /
            // host.credentialsResolver, but the contract permits a caller
            // (e.g. a test harness) to pass different instances — honour
            // them verbatim. No equality assertion: the contract is the rule.
            identifierMapping: idMap,
            credentialsResolver: credRes,
          }),
      };
      host.factoryResolver.registerFactory(
        plugin.manifest.adapterKey,
        factoryAdapter,
      );

      plugin.register?.(host);

      this.logger.log(`Plugin registered: ${plugin.manifest.adapterKey}`);
    }
  }

  return {
    module: PluginHostModule,
    imports: [IntegrationsModule, SyncModule, IdentifierMappingModule, ...imports],
    providers,
    exports: extraExports,
  };
}
