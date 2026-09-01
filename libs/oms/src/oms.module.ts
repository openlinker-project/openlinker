/**
 * OMS Module
 *
 * The NestJS composition seam for `@openlinker/oms`, registered in
 * `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` as a
 * `PluginEntry`. It registers the `openlinker.oms.v1` manifest and its
 * capability factory, so an operator can create a credential-less OMS
 * connection.
 *
 * ## Why this is now a hand-written `@Module` (#2408)
 *
 * Until #2408 this was a `createNestAdapterModule` shim, which is the right
 * helper only *while the descriptor takes no injected dependencies*. The router
 * needs its ruleset, and the ruleset is rows (ADR-054's adopted storage
 * amendment), so the package needs a `TypeOrmModule.forFeature` seam — exactly
 * the conversion Erli made at #1198 and the one this file's previous docblock
 * anticipated.
 *
 * ## The conversion is deliberately NARROW
 *
 * It registers **this package's own entity and nothing else**. It imports no
 * sibling context module — no `InventoryModule`, no `FulfillmentModule`.
 * ADR-051's guarantee is that "a role that is off contributes no providers",
 * and that guarantee is about dragging context modules into the worker's shared
 * spine; a plugin declaring its own table does not touch it. Core services
 * still reach this plugin as factory deps (ADR-055), never as module imports.
 *
 * `OmsModule` stays a named class handing a `DynamicModule` back from a static
 * factory: `libs/oms/src/index.spec.ts` and
 * `apps/worker/test/integration/oms-module-boot.int-spec.ts` assert
 * `typeof OmsModule === 'function'` and its `.name`, and the latter lives under
 * `apps/worker/test/**`, excluded from `pnpm lint`/`type-check` (#786), so
 * breaking it would fail only at integration time.
 *
 * @module libs/oms/src
 * @see docs/architecture/adrs/055-oms-as-credentialless-connection-plugin.md
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createNestAdapterModule } from '@openlinker/plugin-sdk';

import { createOmsPlugin } from './oms.plugin';
import { ROUTING_RULE_SOURCE_TOKEN } from './oms.tokens';
import { OmsRoutingRuleOrmEntity } from './routing/oms-routing-rule.orm-entity';
import { OmsRoutingRuleRepository } from './routing/oms-routing-rule.repository';

@Module({})
export class OmsModule {
  static register(): DynamicModule {
    const adapterModule = createNestAdapterModule({ plugin: createOmsPlugin() });

    return {
      module: OmsModule,
      imports: [TypeOrmModule.forFeature([OmsRoutingRuleOrmEntity]), adapterModule],
      providers: [
        OmsRoutingRuleRepository,
        // Bound to its PORT, not exported as a class: a consumer codes against
        // `RoutingRuleSourcePort` (engineering-standards.md § Repository Ports
        // Pattern), and the concrete repository stays this package's own
        // infrastructure detail — the `allegro.tokens.ts` shape, which likewise
        // publishes the port and the Symbol and never the class or the ORM
        // entity.
        { provide: ROUTING_RULE_SOURCE_TOKEN, useExisting: OmsRoutingRuleRepository },
      ],
      exports: [ROUTING_RULE_SOURCE_TOKEN, adapterModule],
    };
  }
}
