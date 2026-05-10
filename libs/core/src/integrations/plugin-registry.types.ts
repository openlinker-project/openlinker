/**
 * Plugin Registry Types
 *
 * Type definitions for `PluginRegistryModule.forRoot({ plugins })`. Lives at
 * the integrations package top level (not under `domain/`) because both types
 * import from `@nestjs/common`, which is forbidden in the domain layer per
 * `docs/engineering-standards.md` § *Domain Layer Independence*.
 *
 * @module libs/core/src/integrations
 */
import { DynamicModule, Type } from '@nestjs/common';

/**
 * A plugin entry is either a Nest module class (static, no per-env config)
 * or a `DynamicModule` returned by a module's `.register(...)` / `.forRoot(...)`
 * method (e.g. `AiIntegrationModule.register()`).
 */
export type PluginEntry = Type<unknown> | DynamicModule;

/**
 * Options accepted by `PluginRegistryModule.forRoot`.
 */
export interface PluginRegistryOptions {
  /**
   * Integration modules to enable on this app. Each module's own
   * `onModuleInit` is responsible for self-registering with the
   * `AdapterRegistryService` and `AdapterFactoryResolverService` — the
   * registry only composes their imports here.
   */
  plugins: PluginEntry[];
}
