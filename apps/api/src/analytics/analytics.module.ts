/**
 * Analytics API Module
 *
 * Hosts two unrelated concerns under one `/analytics`-flavored module,
 * deliberately reusing the folder rather than splitting it (#1983):
 *
 * 1. **PostHog settings** (`PosthogSettingsController`) — the original
 *    occupant. Resolves its dependency from core `AnalyticsModule`.
 * 2. **`/analytics` needs-attention aggregates** (`NeedsAttentionController`,
 *    #1983) — coverage gaps, stock at risk, value stuck in failed syncs for
 *    the `/analytics` reporting page. Composes `ListingsModule` +
 *    `OrdersModule` (see `NeedsAttentionService`'s own header for why this
 *    composition lives at the app layer instead of in a core context).
 * 3. **`/analytics/sales` sales & channel aggregates** (`SalesAnalyticsController`,
 *    #1987) — revenue/orders/AOV/median/units for the KPI strip + by-channel
 *    table. Single-context read (`orders` owns both source tables), so it
 *    injects `IOrderRecordService` directly rather than a new composition
 *    service — see `SalesAnalyticsController`'s own header.
 * 4. **`/analytics/top-products`** (`TopProductsController`, #1988) — products
 *    ranked by revenue/units with an inline per-channel breakdown, catalog
 *    metadata, and a listing-coverage flag. Fans out across FOUR core
 *    contexts (`orders`, `products`, `listings`, and — since #2765's
 *    per-variant sales drill-down — `inventory` for live stock), so — like
 *    `NeedsAttentionService` — it composes them via `TopProductsService` at
 *    this layer rather than adding a new core-to-core dependency edge; see
 *    that service's own header.
 * 5. **`/analytics/settings`** (`AnalyticsSettingsController`, #2462) — the
 *    display-currency / rate-basis / backfilled-tax-rate-inclusion singleton
 *    row (#2461). `GET` composes the row with the system reporting currency
 *    from `@openlinker/core/currency`, which is why `CurrencyModule` is
 *    imported here alongside `CoreAnalyticsModule`.
 * 6. **`/analytics/coverage`** (`AnalyticsCoverageController`, #2466) — the
 *    Data Coverage panel aggregate: one row per category (currency, tax
 *    A/B/C, product-matching), elevating #2464/#2465's detectors plus the
 *    new product-matching-error detector. Single-context read (`orders`),
 *    same reasoning as `SalesAnalyticsController` — no new composition
 *    service. Reuses `CurrencyModule` (already imported above) for its one
 *    cross-context dependency, `IReportingCurrencySettingsService`.
 *
 * 7. **`/analytics/coverage/currency/*`** (`AnalyticsRemediationController`,
 *    #2468) — the one genuinely-async Data Coverage remediation: open an
 *    `analytics_remediation_runs` row, enqueue the driver job, poll the run,
 *    and page the affected orders. Kept as a sibling of the read-only
 *    `AnalyticsCoverageController` because it writes and needs `admin`; see
 *    its own header. Composes `CoreAnalyticsModule` (the ledger),
 *    `OrdersModule` (the detector count), `CurrencyModule` and `SyncModule`.
 *
 * The concerns share nothing except the URL prefix. If a future
 * `/analytics` route (#1986 route shell, KPI strip, etc.) needs its own
 * module, that is the point to split this into a dedicated module (e.g.
 * `apps/api/src/reporting`) — nothing here depends on the split not
 * happening; the controllers' `@Controller('analytics')` path is
 * independent of which NestJS module registers them.
 *
 * Follows the `{domain}.module.ts` + `{Domain}ApiModule` pattern already
 * used by `MailerApiModule`.
 *
 * @module apps/api/src/analytics
 */
import { Module } from '@nestjs/common';
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { InventoryModule } from '@openlinker/core/inventory';
import { CurrencyModule } from '@openlinker/core/currency';
import { ListingsModule } from '@openlinker/core/listings/services';
import { OrdersModule } from '@openlinker/core/orders';
import { SyncModule } from '@openlinker/core/sync';
import { ProductsModule } from '@openlinker/core/products';
// The apps/api-layer IntegrationsModule (not the core one, which ListingsModule
// already imports for its own internal providers without re-exporting
// INTEGRATIONS_SERVICE_TOKEN) — it re-exports the core module so this token
// becomes resolvable here, mirroring how AppModule itself reaches it.
import { IntegrationsModule as ApiIntegrationsModule } from '../integrations/integrations.module';
import { PosthogSettingsController } from './http/posthog-settings.controller';
import { NeedsAttentionController } from './http/needs-attention.controller';
import { SalesAnalyticsController } from './http/sales-analytics.controller';
import { TopProductsController } from './http/top-products.controller';
import { AnalyticsSettingsController } from './http/analytics-settings.controller';
import { AnalyticsCoverageController } from './http/analytics-coverage.controller';
import { AnalyticsRemediationController } from './http/analytics-remediation.controller';
import { NeedsAttentionService } from './application/services/needs-attention.service';
import { NEEDS_ATTENTION_SERVICE_TOKEN } from './application/services/needs-attention.service.interface';
import { TopProductsService } from './application/services/top-products.service';
import { TOP_PRODUCTS_SERVICE_TOKEN } from './application/services/top-products.service.interface';

@Module({
  imports: [
    CoreAnalyticsModule,
    InventoryModule,
    CurrencyModule,
    ListingsModule,
    OrdersModule,
    ProductsModule,
    ApiIntegrationsModule,
    // #2468 — JOB_ENQUEUE_TOKEN for the currency-remediation driver enqueue.
    SyncModule,
  ],
  controllers: [
    PosthogSettingsController,
    NeedsAttentionController,
    SalesAnalyticsController,
    TopProductsController,
    AnalyticsSettingsController,
    AnalyticsCoverageController,
    AnalyticsRemediationController,
  ],
  providers: [
    NeedsAttentionService,
    {
      provide: NEEDS_ATTENTION_SERVICE_TOKEN,
      useExisting: NeedsAttentionService,
    },
    TopProductsService,
    {
      provide: TOP_PRODUCTS_SERVICE_TOKEN,
      useExisting: TopProductsService,
    },
  ],
})
export class AnalyticsApiModule {}
