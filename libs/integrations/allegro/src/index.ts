/**
 * Allegro Integration Library Exports
 *
 * Public API for the Allegro Public API v1 adapter. Exports adapters,
 * factory, types, and exceptions for use by the adapter registry and
 * IntegrationsService.
 *
 * @module libs/integrations/allegro/src
 */

// Factory
export { AllegroAdapterFactory } from './application/allegro-adapter.factory';
export { IAllegroAdapterFactory } from './application/interfaces/allegro-adapter.factory.interface';

// Types
export { AllegroConnectionConfig, AllegroEnvironment, AllegroEnvironmentValues } from './domain/types/allegro-config.types';
export { AllegroCredentials } from './domain/types/allegro-credentials.types';
export {
  PolishVoivodeshipValues,
  type PolishVoivodeship,
} from './domain/types/allegro-location.types';
export {
  AllegroSafetyInformationTypeValues,
  type AllegroSafetyInformationType,
  type AllegroSafetyInformation,
  type AllegroSellerLocation,
  type AllegroSellerDefaultsConfig,
} from './domain/types/allegro-seller-defaults.types';
export {
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommand,
  AllegroOfferQuantityChangeCommandResponse,
} from './domain/types/allegro-api.types';

// Exceptions
export { AllegroConfigException } from './domain/exceptions/allegro-config.exception';
export { AllegroApiException } from './domain/exceptions/allegro-api.exception';
export { AllegroAuthenticationException } from './domain/exceptions/allegro-authentication.exception';
export { AllegroRateLimitException } from './domain/exceptions/allegro-rate-limit.exception';
export { AllegroNetworkException } from './domain/exceptions/allegro-network.exception';
export { DuplicateAllegroQuantityCommandError } from './domain/exceptions/duplicate-allegro-quantity-command.error';
export { AllegroQuantityCommandNotFoundException } from './domain/exceptions/allegro-quantity-command-not-found.error';
export type { AllegroValidationError } from './domain/types/allegro-api.types';

// Entities
export { AllegroQuantityCommand, AllegroQuantityCommandStatus, AllegroQuantityCommandStatusValues } from './domain/entities/allegro-quantity-command.entity';

// Ports
export { AllegroQuantityCommandRepositoryPort, AllegroQuantityCommandFilters } from './domain/ports/allegro-quantity-command-repository.port';

// Tokens
export { ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN } from './allegro.tokens';

// Token Refresh
export { AllegroTokenRefreshService } from './infrastructure/token-refresh/allegro-token-refresh.service';
export type { TokenRefreshResponse } from './infrastructure/token-refresh/allegro-token-refresh.service';

// Safety attachments (#449)
export {
  ALLEGRO_SAFETY_ATTACHMENT_UPLOAD_PATH,
  ALLEGRO_SAFETY_ATTACHMENT_MAX_BYTES,
  ACCEPTED_SAFETY_ATTACHMENT_MIME_TYPES,
  ALLEGRO_SAFETY_ATTACHMENT_MIME_PATTERN,
} from './domain/types/allegro-safety-attachments.types';

// Adapters exposed for end-to-end behavioural test wiring.
//
// Production wiring goes through `AllegroIntegrationModule.onModuleInit`
// registration, not this barrel. We export the retry classifier because
// the worker's runner spec (`apps/worker/src/sync/__tests__/sync-job.runner.spec.ts`)
// constructs a real `RetryClassifierRegistryService` and registers the
// real adapter against it to verify behaviour preservation across the
// #581 refactor. Going via the barrel keeps the test's import on the
// alias path (per `engineering-standards.md` §"Import Aliases") rather
// than reaching into the package's internal structure.
//
// `AllegroConnectionTesterAdapter` is intentionally NOT exported because
// no external spec needs it — its host module is the only consumer.
// If a future runner-spec-shaped behavioural test ever needs it, this
// asymmetry should be reconsidered (export both, or move both behind
// deep paths).
export { AllegroRetryClassifierAdapter } from './infrastructure/adapters/allegro-retry-classifier.adapter';

// Module
export { AllegroIntegrationModule } from './allegro-integration.module';

