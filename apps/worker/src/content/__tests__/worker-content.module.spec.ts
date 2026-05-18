/**
 * Worker Content Module Wiring Test
 *
 * Asserts the DI wiring that resolves `AI_COMPLETION_PORT_TOKEN` for
 * `ContentSuggestionService` in the worker process (#737). The original
 * defect: `WorkerContentModule` imported only `CoreIntegrationsModule`,
 * which does not expose the per-plugin tokens contributed by
 * `workerPlugins` (notably `AI_COMPLETION_PORT_TOKEN` from
 * `AiIntegrationModule.register()`). Nest blew up at worker boot with
 * "Nest can't resolve dependencies of the ContentSuggestionService ...
 * Symbol(AiCompletionPort)".
 *
 * The fix wires `WorkerContentModule` to the worker-side `IntegrationsModule`
 * wrapper (`apps/worker/src/integrations/integrations.module.ts`), which
 * composes the plugin list via `PluginRegistryModule.forRoot(...)` and
 * re-exports `PluginRegistryModule`. This test pins that contract with two
 * structural assertions so removing either side fails at unit-test time
 * rather than at worker boot.
 *
 * Structural (Reflect-metadata) rather than behavioural because compiling
 * `WorkerContentModule` end-to-end would require booting `DatabaseModule`,
 * `RedisConfigModule`, and the full plugin graph — that's covered by the
 * worker integration suite (which DID catch the defect locally), but is not
 * yet wired into CI (`.github/workflows/ci.yml` runs only
 * `pnpm --filter @openlinker/api test:integration`). A unit-level structural
 * gate runs under `pnpm test:ci` for every PR.
 *
 * @module apps/worker/src/content
 */
import 'reflect-metadata';
import { PluginRegistryModule } from '@openlinker/core/integrations';
import { IntegrationsModule as WorkerIntegrationsModule } from '../../integrations/integrations.module';
import { WorkerContentModule } from '../worker-content.module';

describe('WorkerContentModule wiring (#737)', () => {
  it('imports the worker IntegrationsModule wrapper so AI_COMPLETION_PORT_TOKEN resolves', () => {
    const imports = (Reflect.getMetadata('imports', WorkerContentModule) ?? []) as unknown[];

    expect(imports).toContain(WorkerIntegrationsModule);
  });

  it('IntegrationsModule wrapper re-exports PluginRegistryModule so per-plugin tokens propagate', () => {
    const exports = (Reflect.getMetadata('exports', WorkerIntegrationsModule) ?? []) as unknown[];

    expect(exports).toContain(PluginRegistryModule);
  });
});
