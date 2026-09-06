/**
 * Fulfilment Router Binding Module — worker (#2408)
 *
 * Binds `FULFILLMENT_ROUTER_RESOLVER_TOKEN` to the OMS resolver so the two core
 * call sites — #2396's ingestion intercept in `OrderIngestionService` and the
 * `fulfillment.work.route` handler — can resolve a router. `libs/core` may not
 * import `@openlinker/oms`, so the composition has to happen host-side.
 *
 * **Both production call sites execute in this process**, which is why the
 * worker's binding is the load-bearing one and the API's is its twin rather than
 * the other way round.
 *
 * ## Three mechanics that are easy to get wrong
 *
 * **`@Global()` publishes a module's `exports`, not its `providers`.** Without
 * the `exports` line below the token is invisible to `OrdersModule` — where
 * `OrderIngestionService` is declared, and therefore where the injection
 * resolves from. Because that injection is REQUIRED, omitting the export is a
 * boot failure rather than a silent no-op, which is the whole reason it is
 * required (see the port's header).
 *
 * **The import is the host `IntegrationsModule`, never `PluginRegistryModule`.**
 * The latter is a `@Module({})` shell with a static `forRoot`; importing the
 * bare class yields an empty module and `ROUTING_RULE_SOURCE_TOKEN` does not
 * resolve, while calling `forRoot` again would double-register every plugin. The
 * host wrapper re-exports it — the same route `WorkerContentModule` already
 * takes to plugin-registered providers.
 *
 * **`InventoryModule` here is core's**, matching the worker's SHARED array; the
 * API composes its own wrapper instead.
 *
 * ## Why SHARED rather than the `jobs` role
 *
 * `OrdersModule` is **not** in the worker's SHARED array — it is imported by
 * `SyncWorkerModule`, so both call sites live under `jobs` and a `jobs`-only
 * binding would produce no split answer. SHARED is chosen anyway because a
 * `@Global()` module must be in the graph to be global, it costs one factory
 * call, and every context module it imports is already SHARED — so ADR-051's
 * guarantee that a role which is off contributes no *context modules* is
 * untouched.
 *
 * @module apps/worker/src/fulfillment
 */
import { Global, Module } from '@nestjs/common';

import {
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  FULFILLMENT_WORK_QUERY_SERVICE_TOKEN,
  FulfillmentModule,
  type IFulfillmentWorkQueryService,
} from '@openlinker/core/fulfillment';
import {
  CONNECTION_PORT_TOKEN,
  IdentifierMappingModule,
  type ConnectionPort,
} from '@openlinker/core/identifier-mapping';
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  InventoryModule,
  LOCATION_SERVICE_TOKEN,
  type IInventoryQueryService,
  type ILocationService,
} from '@openlinker/core/inventory';
import {
  ROUTING_RULE_SOURCE_TOKEN,
  createOmsFulfillmentRouterResolver,
  type RoutingRuleSourcePort,
} from '@openlinker/oms';

import { IntegrationsModule } from '../integrations/integrations.module';

@Global()
@Module({
  imports: [IntegrationsModule, InventoryModule, FulfillmentModule, IdentifierMappingModule],
  providers: [
    {
      provide: FULFILLMENT_ROUTER_RESOLVER_TOKEN,
      useFactory: (
        connections: ConnectionPort,
        rules: RoutingRuleSourcePort,
        locations: ILocationService,
        inventory: IInventoryQueryService,
        works: IFulfillmentWorkQueryService
      ) => createOmsFulfillmentRouterResolver({ connections, rules, locations, inventory, works }),
      inject: [
        CONNECTION_PORT_TOKEN,
        ROUTING_RULE_SOURCE_TOKEN,
        LOCATION_SERVICE_TOKEN,
        INVENTORY_QUERY_SERVICE_TOKEN,
        FULFILLMENT_WORK_QUERY_SERVICE_TOKEN,
      ],
    },
  ],
  exports: [FULFILLMENT_ROUTER_RESOLVER_TOKEN],
})
export class FulfillmentRouterBindingModule {}
