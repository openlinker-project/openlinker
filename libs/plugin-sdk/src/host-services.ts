/**
 * HostServices — typed bag of services the host provides to a plugin
 *
 * Defines the curated, framework-neutral surface every adapter plugin can
 * rely on. Two categories live in this bag (separated by comment block):
 *
 *   1. Read inputs — services the plugin USES at runtime when fulfilling
 *      its `createCapabilityAdapter(connection, capability, host)` calls.
 *      Examples: `logger`, `identifierMapping`, `credentialsResolver`,
 *      `cache`.
 *
 *   2. Side registries — services the plugin REGISTERS into once at boot
 *      via its `register(host)` method. Examples: `adapterRegistry`,
 *      `factoryResolver`, `connectionTesterRegistry`,
 *      `webhookProvisioningRegistry`, …
 *
 * Plugin-specific cross-package ports (`CustomerIdentityResolverPort`,
 * `CustomerProjectionRepositoryPort`, `IMappingConfigService`,
 * `WebhookSecretProviderPort`, `IntegrationCredentialRepositoryPort`) are
 * NOT in this bag — the conservative cut (#593). Plugins that need them
 * import via the existing cross-package mechanism and pass them into the
 * descriptor's closure via their factory constructor (e.g.
 * `createAllegroPlugin({ customerIdentityResolver, … })`).
 *
 * Field additions: when a new plugin author asks for a service in this
 * bag, weigh "every plausible future plugin needs this" against keeping
 * the surface lean. Open a follow-up issue rather than silently expand
 * the contract.
 *
 * @module libs/plugin-sdk/src
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { CachePort } from '@openlinker/shared';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type {
  AdapterRegistryPort,
  AdapterFactoryResolverService,
  ConnectionTesterRegistryService,
  EmailNormalizerRegistryService,
  WebhookProvisioningRegistryService,
  WebhookEventTranslatorRegistryService,
  ConnectionConfigShapeValidatorRegistryService,
  ConnectionCredentialsShapeValidatorRegistryService,
  OAuthCompletionRegistryService,
  CredentialsResolverPort,
} from '@openlinker/core/integrations';
import type {
  RetryClassifierRegistryService,
  AuthFailureClassifierRegistryService,
  SchedulerTaskRegistryService,
} from '@openlinker/core/sync';

export interface HostServices {
  // --- Read inputs (plugin USES) ---

  /**
   * Per-context logger factory. Mirrors the project-wide convention of
   * `new Logger(ClassName.name)` from `@openlinker/shared/logging`; a
   * factory so plugins can scope per-class without each plugin needing
   * its own Nest-aware glue.
   */
  readonly logger: (context: string) => LoggerPort;

  /** Process-wide identifier mapping service. */
  readonly identifierMapping: IdentifierMappingPort;

  /** Process-wide credentials resolver. */
  readonly credentialsResolver: CredentialsResolverPort;

  /**
   * Optional distributed cache. Plugins that use it must tolerate `undefined`
   * — host bootstraps that skip `CacheModule` (unit-test scenarios) leave
   * this field unset.
   */
  readonly cache?: CachePort;

  // --- Side registries (plugin REGISTERS into at boot) ---

  /**
   * Adapter manifest registry. Plugin's `register()` (or the host's
   * wrapping module) calls `adapterRegistry.register(plugin.manifest)`
   * exactly once at boot.
   */
  readonly adapterRegistry: AdapterRegistryPort;

  /**
   * Per-connection adapter-factory registry. Wrapping module binds the
   * plugin's `createCapabilityAdapter` here under its `manifest.adapterKey`.
   */
  readonly factoryResolver: AdapterFactoryResolverService;

  /** Connection-test adapter registry (used by `ConnectionService.testConnection`). */
  readonly connectionTesterRegistry: ConnectionTesterRegistryService;

  /** Email-normalizer registry — for marketplaces with masked-email schemes (Allegro). */
  readonly emailNormalizerRegistry: EmailNormalizerRegistryService;

  /** Retry-classifier registry — adapter-owned exception-to-retry-policy mapping (#581). */
  readonly retryClassifierRegistry: RetryClassifierRegistryService;

  /**
   * Auth-failure classifier registry — adapter-owned mapping from an exception
   * to "this is a terminal credential rejection, the connection needs
   * re-authentication" (#819). The runner consults it at the dead-job boundary
   * to flag the originating connection. Narrower than the retry classifier: a
   * non-retryable validation error must NOT be classified here.
   */
  readonly authFailureClassifierRegistry: AuthFailureClassifierRegistryService;

  /** Scheduler-task registry — adapter-contributed cron tasks (#584). */
  readonly schedulerTaskRegistry: SchedulerTaskRegistryService;

  /** Webhook-provisioning registry — adapter-installable webhook flows (#583). */
  readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService;

  /**
   * Webhook-event-translator registry (ADR-015 / #903). A plugin registers a
   * `WebhookEventTranslatorPort` here to decode its native inbound webhook
   * events into neutral `CanonicalInboundEvent`s. Pure, payload-in transform —
   * the core routing policy then maps domain → job. Absence degrades to
   * poll-only (a stray webhook dead-letters as "no translator").
   */
  readonly webhookEventTranslatorRegistry: WebhookEventTranslatorRegistryService;

  /**
   * Per-plugin `Connection.config` shape-validator registry (#587). A plugin
   * registers a `ConnectionConfigShapeValidatorPort` here at boot to enforce
   * the typed shape of its `Connection.config` JSONB blob on create/update.
   * Absence is a deliberate skip — plugins with no fixed config shape need
   * not register one.
   */
  readonly connectionConfigShapeValidatorRegistry: ConnectionConfigShapeValidatorRegistryService;

  /**
   * Per-plugin credentials shape-validator registry (#586). A plugin
   * registers a `ConnectionCredentialsShapeValidatorPort` here to validate
   * the raw credentials payload's shape on create / rotation. Shape only —
   * the "do these credentials actually authenticate" check is
   * `ConnectionTesterPort` against the live API.
   */
  readonly connectionCredentialsShapeValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService;

  /**
   * Per-plugin OAuth-completion registry (#859). A plugin whose platform uses
   * an OAuth2 authorization-code flow registers an `OAuthCompletionPort` here
   * at boot; the host's `OAuthConnectionService` resolves it by `adapterKey`
   * to perform the authorize-URL / code-exchange / identity steps without the
   * host importing the plugin. Absence is a deliberate skip — non-OAuth
   * platforms need not register one.
   */
  readonly oauthCompletionRegistry: OAuthCompletionRegistryService;
}
