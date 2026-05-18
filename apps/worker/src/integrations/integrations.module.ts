/**
 * Worker Integrations Module
 *
 * Composes the worker's plugin list (`workerPlugins`) via
 * `PluginRegistryModule.forRoot({ plugins })` and re-exports
 * `PluginRegistryModule` so downstream modules (e.g. `WorkerContentModule`)
 * resolve per-plugin tokens (`AI_COMPLETION_PORT_TOKEN`, etc.) through a
 * single import of this module. Mirrors the API-side wrapper at
 * `apps/api/src/integrations/integrations.module.ts`.
 *
 * Naming convention: this class is intentionally also called
 * `IntegrationsModule`, matching the API-side wrapper and shadowing the
 * core `IntegrationsModule` from `@openlinker/core/integrations`. Consumers
 * resolve the collision by aliasing the core module on import
 * (`import { IntegrationsModule as CoreIntegrationsModule }`); the host-side
 * wrapper keeps the unqualified name in every app to make "this is the
 * per-app plugin-composition seam" instantly recognizable.
 *
 * @module apps/worker/src/integrations
 */
import { Module } from '@nestjs/common';
import { PluginRegistryModule } from '@openlinker/core/integrations';
import { workerPlugins } from '../plugins';

@Module({
  imports: [PluginRegistryModule.forRoot({ plugins: workerPlugins })],
  exports: [PluginRegistryModule],
})
export class IntegrationsModule {}
