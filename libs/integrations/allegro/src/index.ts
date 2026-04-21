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
  AllegroOrderEventsResponse,
  AllegroOfferQuantityChangeCommand,
  AllegroOfferQuantityChangeCommandResponse,
} from './domain/types/allegro-api.types';

// Exceptions
export { AllegroConfigException } from './domain/exceptions/allegro-config.exception';
export { AllegroApiException } from './domain/exceptions/allegro-api.exception';
export { AllegroAuthenticationException } from './domain/exceptions/allegro-authentication.exception';
export { AllegroRateLimitException } from './domain/exceptions/allegro-rate-limit.exception';
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

// Module
export { AllegroIntegrationModule } from './allegro-integration.module';

