/**
 * Amazon Integration - Public API
 *
 * Barrel for `@openlinker/integrations-amazon`.
 *
 * @module libs/integrations/amazon/src
 */

export { createAmazonPlugin, amazonAdapterManifest } from './amazon-plugin';
export { AmazonIntegrationModule } from './amazon-integration.module';

export {
  AMAZON_ADAPTER_KEY,
  AMAZON_PLATFORM_TYPE,
  AMAZON_KNOWN_MARKETPLACES,
  AmazonRegionValues,
  AmazonEnvironmentValues,
  type AmazonRegion,
  type AmazonEnvironment,
} from './amazon.constants';

export { AmazonAdapterFactory } from './application/amazon-adapter.factory';
export type {
  AmazonResolution,
  IAmazonAdapterFactory,
} from './application/interfaces/amazon-adapter.factory.interface';

export { parseAmazonConfig } from './domain/policies/amazon-config.policy';
export type { AmazonConnectionConfig } from './domain/types/amazon-config.types';
export {
  AmazonCredentialSourceValues,
  type AmazonCredentialSource,
  type AmazonCredentials,
} from './domain/types/amazon-credentials.types';
