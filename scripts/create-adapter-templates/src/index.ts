/**
 * __Name__ Integration — Public API
 *
 * Barrel for `@openlinker/integrations-__name__`. Exports the plugin
 * descriptor factory, the static manifest, and the NestJS module the
 * host imports via `apps/api/src/plugins.ts`.
 *
 * As capabilities, exceptions, and types are added, re-export them here
 * if external consumers (host integration tests, sibling plugins) need
 * them. Keep the surface narrow by default.
 *
 * @module libs/integrations/__name__/src
 */

export {
  create__Name__Plugin,
  __camelName__AdapterManifest,
  type Create__Name__PluginDeps,
} from './__name__-plugin';

export { __Name__IntegrationModule } from './__name__-integration.module';

export type { __Name__ConnectionConfig } from './domain/types/__name__-config.types';
export type { __Name__Credentials } from './domain/types/__name__-credentials.types';
