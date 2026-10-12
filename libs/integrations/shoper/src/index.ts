/**
 * @openlinker/integrations-shoper — Public Barrel
 *
 * Shoper REST API adapter plugin. The runtime entry the host composes is
 * `ShoperIntegrationModule`; the barrel also exports the static manifest and
 * the config / credentials types. Transport errors and the HTTP client are
 * deliberately NOT exported: they are adapter-layer details that must not
 * escape the plugin.
 *
 * @module libs/integrations/shoper/src
 */

export { createShoperPlugin, shoperAdapterManifest } from './shoper-plugin';

export { ShoperIntegrationModule } from './shoper-integration.module';

export { SHOPER_REQUIRED_SCOPES } from './shoper.constants';

export type { ShoperConnectionConfig } from './domain/types/shoper-config.types';
export type { ShoperCredentials } from './domain/types/shoper-credentials.types';
