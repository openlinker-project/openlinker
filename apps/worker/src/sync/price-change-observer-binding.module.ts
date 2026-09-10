/**
 * Price Change Observer Binding Module — Worker (#3143, ADR-072)
 *
 * The worker twin of `apps/api/src/listings/price-change-observer-binding.module.ts`
 * — see that file for the full rationale. Imported from `SyncWorkerModule`
 * (the `jobs` role) rather than the shared module array: `ListingsModule`
 * (services) is itself a `jobs`-role-scoped import today, and
 * `MasterProductSyncService`'s job handlers run under that same role, so
 * there is no other role this binding needs to reach. `@Global()` still
 * publishes the token application-wide once this module loads anywhere in
 * the graph — it just never NEEDS to load anywhere but here.
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
