/**
 * @openlinker/integrations-mirakl: Public Barrel
 *
 * Mirakl Seller API plugin, with Empik Marketplace as its first operator
 * (epic #4273, ADR-086). The host composes `EmpikIntegrationModule`. The HTTP
 * client, pagination helpers and import tracker stay package-private; the
 * typed exceptions are public because host-side classifiers and tests match on
 * them.
 *
 * @module libs/integrations/mirakl/src
 */

// Plugin descriptor, manifest builder and operator profiles
export { buildMiraklAdapterManifest, createMiraklPlugin } from './mirakl-plugin';
export { empikOperatorProfile } from './operators/empik.profile';
export { EMPIK_ADAPTER_KEY } from './mirakl.constants';

// Host wiring
export { EmpikIntegrationModule } from './empik-integration.module';

// Types
export type { MiraklOperatorProfile } from './domain/types/mirakl-operator-profile.types';
export type {
  MiraklConnectionConfig,
  MiraklCredentials,
  MiraklEnvironment,
} from './domain/types/mirakl-connection.types';
export type { IMiraklAdapterFactory } from './application/interfaces/mirakl-adapter.factory.interface';

// Exceptions
export { MiraklApiException } from './domain/exceptions/mirakl-api.exception';
export { MiraklAuthenticationException } from './domain/exceptions/mirakl-authentication.exception';
export { MiraklConfigException } from './domain/exceptions/mirakl-config.exception';
export { MiraklNetworkException } from './domain/exceptions/mirakl-network.exception';
export { MiraklRateLimitException } from './domain/exceptions/mirakl-rate-limit.exception';
