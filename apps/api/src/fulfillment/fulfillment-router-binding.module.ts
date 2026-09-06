/**
 * Fulfilment Router Binding Module — API (#2408)
 *
 * Binds `FULFILLMENT_ROUTER_RESOLVER_TOKEN` to the OMS resolver so the two core
 * call sites — #2396's ingestion intercept in `OrderIngestionService` and the
 * `fulfillment.work.route` handler — can resolve a router. `libs/core` may not
 * import `@openlinker/oms`, so the composition has to happen host-side.
 *
 * ## Three mechanics that are easy to get wrong
 *
 * **`@Global()` publishes a module's `exports`, not its `providers`.** Without
 * the `exports` line below the token is invisible to `OrdersModule`, which is
 * where `OrderIngestionService` is declared and therefore where the injection
 * resolves from. Because that injection is REQUIRED, omitting the export is a
 * boot failure rather than a silent no-op — which is the whole reason it is
 * required (see the port's header).
 *
 * **The import is the host `IntegrationsModule`, never `PluginRegistryModule`.**
 * The latter is a `@Module({})` shell with a static `forRoot`; importing the
 * bare class yields an empty module and `ROUTING_RULE_SOURCE_TOKEN` does not
 * resolve, while calling `forRoot` again would double-register every plugin. The
 * host wrapper re-exports it, which is how `HealthModule` and `WorkerContentModule`
 * already reach plugin-registered providers.
 *
 * **`InventoryModule` here is CORE's, never the API's own wrapper.** The wrapper
 * (`apps/api/src/inventory/inventory.module.ts`) imports core's module to get
 * providers for its two controllers and declares **no `exports` array at all**,
 * so importing it hands this module nothing and `LOCATION_SERVICE_TOKEN` does
 * not resolve. That is not a style preference: the injection below is REQUIRED,
 * so the mistake is an API BOOT FAILURE rather than a degraded feature — it was
 * caught by `fulfillment-router-wiring.int-spec.ts` and by no unit test, because
 * `pnpm test` never builds the Nest graph. Core's module is what exports both
 * `LOCATION_SERVICE_TOKEN` and `INVENTORY_QUERY_SERVICE_TOKEN`, which is also
 * exactly what the worker's twin imports.
 *
 * ## Two host modules, one body
 *
 * The worker has a twin of this file. A single shared module is not reachable:
 * each host owns its own `IntegrationsModule` wrapper and `libs/` may not import
 * from `apps/`. What is shared is the thing that matters — the *decision* lives
 * once, in `createOmsFulfillmentRouterResolver`; these modules supply only
 * wiring, and a host that omits one fails to boot rather than quietly running
 * router-less.
 *
 * @module apps/api/src/fulfillment
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
