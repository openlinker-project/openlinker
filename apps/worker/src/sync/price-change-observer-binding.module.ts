/**
 * Price Change Observer Binding Module — Worker (#3143, ADR-072)
 *
 * `PriceChangeObserverPort` (`libs/core/src/products/domain/ports/price-change-observer.port.ts`)
 * — see that port's own docblock for the full rationale: `products` reports
 * a price change but may not import `listings` (which already imports
 * `ProductsModule` back, per #824), so the port is bound to
 * `PriceChangeDetectionService` here, at the composition root, rather than
 * inside `ProductsModule` itself.
 *
 * This IS the real and only binding — there is no API-side counterpart.
 * `MasterProductSyncService` (the port's sole consumer) is only ever invoked
 * by the worker's job handlers; the API process only enqueues those jobs, so
 * an API-side binding module was dead weight and was removed (#3159 review).
 *
 * Imported from `SyncWorkerModule` (the `jobs` role) rather than the shared
 * module array: `ListingsModule` (services) is itself a `jobs`-role-scoped
 * import today, and `MasterProductSyncService`'s job handlers run under that
 * same role, so there is no other role this binding needs to reach.
 * `@Global()` still publishes the token application-wide once this module
 * loads anywhere in the graph — it just never NEEDS to load anywhere but
 * here.
 *
 * @module apps/worker/src/sync
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
