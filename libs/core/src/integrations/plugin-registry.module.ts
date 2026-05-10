/**
 * Plugin Registry Module
 *
 * Single seam that replaces the previously hand-coded list of integration
 * modules in `apps/api` and `apps/worker`. Apps declare which integrations
 * they want via `PluginRegistryModule.forRoot({ plugins: [...] })`; the
 * plugins themselves stay responsible for registering their adapter metadata
 * + factories via `onModuleInit` (the pattern #570/#571 landed in
 * `AdapterRegistryService` / `AdapterFactoryResolverService`).
 *
 * The composed `DynamicModule` re-exports every plugin so downstream modules
 * that depend on per-plugin tokens (`AI_COMPLETION_PORT_TOKEN`, etc.) keep
 * resolving the same way they did before this seam existed.
 *
 * @module libs/core/src/integrations
 */
import { DynamicModule, Inject, Module, OnModuleInit } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { PLUGIN_REGISTRY_OPTIONS_TOKEN } from './integrations.tokens';
import { PluginEntry, PluginRegistryOptions } from './plugin-registry.types';

@Module({})
export class PluginRegistryModule implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistryModule.name);

  constructor(
    @Inject(PLUGIN_REGISTRY_OPTIONS_TOKEN)
    private readonly options: PluginRegistryOptions,
  ) {}

  static forRoot(options: PluginRegistryOptions): DynamicModule {
    return {
      module: PluginRegistryModule,
      imports: options.plugins,
      providers: [{ provide: PLUGIN_REGISTRY_OPTIONS_TOKEN, useValue: options }],
      exports: options.plugins,
    };
  }

  onModuleInit(): void {
    const names = this.options.plugins.map((plugin) => pluginName(plugin));
    const noun = names.length === 1 ? 'plugin' : 'plugins';
    this.logger.log(`Composed ${names.length} ${noun}: [${names.join(', ')}]`);
  }
}

function pluginName(plugin: PluginEntry): string {
  if (typeof plugin === 'function') {
    return plugin.name;
  }
  return plugin.module.name;
}
