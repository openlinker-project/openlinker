/**
 * OMS Module
 *
 * The NestJS composition seam for `@openlinker/oms`, registered in
 * `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as a
 * `PluginEntry`. Since #2405 it carries the real plugin descriptor: booting a
 * host now registers the `openlinker.oms.v1` manifest and its capability
 * factory, so an operator can create a credential-less OMS connection.
 *
 * **Why `register()` rather than a bare `DynamicModule` const.**
 * `createNestAdapterModule` returns a `DynamicModule` *object*, and both
 * `libs/oms/src/index.spec.ts` and
 * `apps/worker/test/integration/oms-module-boot.int-spec.ts` assert
 * `typeof OmsModule === 'function'` (the latter also asserts
 * `OmsModule.name`). Exporting the object directly would break three
 * assertions across two files — one of which lives in `apps/worker/test/**`,
 * excluded from `pnpm lint` and `pnpm type-check` (#786), so it would fail
 * only at integration time. Keeping `OmsModule` a named class and handing the
 * dynamic module back from a static factory is the shipped
 * `AiIntegrationModule.register()` shape, already used by both `plugins.ts`
 * files.
 *
 * `createNestAdapterModule` is the right helper *while the descriptor takes no
 * injected dependencies*. When #2408/#2409 need core services in the closure,
 * this converts to a hand-written `@Module` class — exactly the conversion
 * Erli made at #1198 for the same reason.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import type { DynamicModule } from '@nestjs/common';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createOmsPlugin } from './oms.plugin';

export class OmsModule {
  static register(): DynamicModule {
    return createNestAdapterModule({ plugin: createOmsPlugin() });
  }
}
