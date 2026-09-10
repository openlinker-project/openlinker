/**
 * Price Change Observer Binding Module — API (#3143, ADR-072)
 *
 * Binds `PRICE_CHANGE_OBSERVER_TOKEN` (owned by `products`, see that port's
 * docblock) to `listings`'s `PriceChangeDetectionService`. `libs/core`'s
 * `ProductsModule` may not import `ListingsModule` back — `ListingsModule`
 * already imports `ProductsModule` for per-variant master stock (#824) — so
 * the composition has to happen host-side, mirroring
 * `FulfillmentRouterBindingModule`'s `libs/core -> libs/oms` binding shape
 * applied to a same-package reverse-dependency edge instead.
 *
 * `@Global()` publishes this module's `exports`, not its `providers` — without
 * the `exports` line the token stays invisible to `ProductsModule`, where
 * `MasterProductSyncService` is declared and therefore where the injection
 * resolves from. That injection is `@Optional()`, so omitting this module
 * entirely is a silent "no price-change detection" rather than a boot
 * failure — a host that hasn't wired this feature keeps working exactly as
 * before #3143.
 *
 * The import is `@openlinker/core/listings/services` (the Nest-wiring
 * sub-barrel), never the bare `@openlinker/core/listings` contract barrel —
 * the latter carries no `@Injectable()` classes to instantiate.
 *
 * @module apps/api/src/listings
 */
import { Global, Module } from '@nestjs/common';
import { PRICE_CHANGE_OBSERVER_TOKEN } from '@openlinker/core/products';
import { PRICE_CHANGE_DETECTION_SERVICE_TOKEN } from '@openlinker/core/listings';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';

@Global()
@Module({
  imports: [CoreListingsModule],
  providers: [
    {
      provide: PRICE_CHANGE_OBSERVER_TOKEN,
      useExisting: PRICE_CHANGE_DETECTION_SERVICE_TOKEN,
    },
  ],
  exports: [PRICE_CHANGE_OBSERVER_TOKEN],
})
export class PriceChangeObserverBindingModule {}
