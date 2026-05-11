/**
 * Plugin Registry Module Unit Tests
 *
 * Verifies the composition contract of `PluginRegistryModule.forRoot({ plugins })`:
 * - the returned `DynamicModule` lists every plugin in `imports` and `exports`
 * - a token provided by a plugin resolves at a consumer that imports the registry
 * - a `DynamicModule` plugin (the production shape used by `AiIntegrationModule.register()`)
 *   resolves through the registry the same way a static `@Module()` plugin does
 * - the boot log fires with the composed plugin names
 *
 * @module libs/core/src/integrations
 */
import { DynamicModule, Module } from '@nestjs/common';
import { Logger as SharedLogger } from '@openlinker/shared/logging';
import { Test } from '@nestjs/testing';
import { PluginRegistryModule } from './plugin-registry.module';

const FAKE_PLUGIN_A_TOKEN = Symbol('FakePluginAToken');
const FAKE_PLUGIN_C_TOKEN = Symbol('FakePluginCToken');

@Module({
  providers: [{ provide: FAKE_PLUGIN_A_TOKEN, useValue: 'fake-plugin-a-value' }],
  exports: [FAKE_PLUGIN_A_TOKEN],
})
class FakePluginAModule {}

@Module({})
class FakePluginBModule {}

class FakePluginCModule {
  static register(value: string): DynamicModule {
    return {
      module: FakePluginCModule,
      providers: [{ provide: FAKE_PLUGIN_C_TOKEN, useValue: value }],
      exports: [FAKE_PLUGIN_C_TOKEN],
    };
  }
}

describe('PluginRegistryModule', () => {
  describe('forRoot', () => {
    it('should list every plugin in imports and exports when given an array', () => {
      const dynamicModule = PluginRegistryModule.forRoot({
        plugins: [FakePluginAModule, FakePluginBModule],
      });

      expect(dynamicModule.module).toBe(PluginRegistryModule);
      expect(dynamicModule.imports).toEqual([FakePluginAModule, FakePluginBModule]);
      expect(dynamicModule.exports).toEqual([FakePluginAModule, FakePluginBModule]);
    });

    it('should resolve a token provided by a static plugin through the registry', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          PluginRegistryModule.forRoot({ plugins: [FakePluginAModule, FakePluginBModule] }),
        ],
      }).compile();

      const value = moduleRef.get(FAKE_PLUGIN_A_TOKEN);
      expect(value).toBe('fake-plugin-a-value');

      await moduleRef.close();
    });

    it('should resolve a token provided by a DynamicModule plugin through the registry', async () => {
      // This mirrors the production shape: `AiIntegrationModule.register()` returns a
      // `DynamicModule`, and `ContentApiModule` must resolve `AI_COMPLETION_PORT_TOKEN`
      // through the chain `IntegrationsModule` → `PluginRegistryModule` re-export.
      const moduleRef = await Test.createTestingModule({
        imports: [
          PluginRegistryModule.forRoot({
            plugins: [FakePluginCModule.register('fake-plugin-c-value')],
          }),
        ],
      }).compile();

      const value = moduleRef.get(FAKE_PLUGIN_C_TOKEN);
      expect(value).toBe('fake-plugin-c-value');

      await moduleRef.close();
    });

    it('should log the composed plugin names when the module initialises', async () => {
      const logSpy = jest
        .spyOn(SharedLogger.prototype, 'log')
        .mockImplementation(() => undefined);

      const moduleRef = await Test.createTestingModule({
        imports: [
          PluginRegistryModule.forRoot({ plugins: [FakePluginAModule, FakePluginBModule] }),
        ],
      }).compile();

      await moduleRef.init();

      const logged = logSpy.mock.calls
        .map((args) => String(args[0]))
        .find((message) => message.includes('Composed'));
      expect(logged).toContain('FakePluginAModule');
      expect(logged).toContain('FakePluginBModule');
      expect(logged).toContain('2 plugins');

      await moduleRef.close();
      logSpy.mockRestore();
    });
  });
});
