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
import { ListingsModule } from '@openlinker/core/listings/services';
import { OrdersModule } from '@openlinker/core/orders';
import { PosthogSettingsController } from './http/posthog-settings.controller';
import { NeedsAttentionController } from './http/needs-attention.controller';
import { SalesAnalyticsController } from './http/sales-analytics.controller';
import { NeedsAttentionService } from './application/services/needs-attention.service';
import { NEEDS_ATTENTION_SERVICE_TOKEN } from './application/services/needs-attention.service.interface';

@Module({
  imports: [CoreAnalyticsModule, ListingsModule, OrdersModule],
  controllers: [PosthogSettingsController, NeedsAttentionController, SalesAnalyticsController],
  providers: [
    NeedsAttentionService,
    {
      provide: NEEDS_ATTENTION_SERVICE_TOKEN,
      useExisting: NeedsAttentionService,
    },
  ],
})
export class AnalyticsApiModule {}
