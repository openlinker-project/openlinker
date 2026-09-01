/**
 * Application Root Module
 *
 * Root NestJS module that configures and imports all application modules,
 * including database, Redis, scheduling, and core bounded contexts.
 * Serves as the entry point for dependency injection and module composition.
 *
 * @module apps/api/src
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppInfoModule } from './app-info/app-info.module';
import { DatabaseModule } from '@openlinker/shared/database';
import { RedisConfigModule } from '@openlinker/shared/redis';
import { CacheModule } from '@openlinker/shared/cache';
import { HealthModule } from './health/health.module';
import { IdentifierMappingModule } from '@openlinker/core/identifier-mapping';
import { CustomersModule } from '@openlinker/core/customers';
import { ReturnsModule } from '@openlinker/core/returns';
import { AutomationModule } from '@openlinker/core/automation';
import { FulfillmentModule } from '@openlinker/core/fulfillment';
import { ContentModule } from '@openlinker/core/content';
import { InvoicingModule } from '@openlinker/core/invoicing';
import { FiscalizationModule } from '@openlinker/core/fiscalization';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import { AnalyticsModule as CoreAnalyticsModule } from '@openlinker/core/analytics';
import { MailerModule as CoreMailerModule } from '@openlinker/core/mailer';
import { AuthModule } from './auth/auth.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SyncModule } from './sync/sync.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { ProductsApiModule } from './products/products.module';
import { CustomersApiModule } from './customers/customers.module';
import { ListingsApiModule } from './listings/listings.module';
import { CursorsModule } from './cursors/cursors.module';
import { MappingsApiModule } from './mappings/mappings.module';
import { AiApiModule } from './ai/ai.module';
import { ContentApiModule } from './content/content.module';
import { ShippingApiModule } from './shipping/shipping.module';
import { InvoicingApiModule } from './invoicing/invoicing.module';
import { FiscalizationApiModule } from './fiscalization/fiscalization.module';
import { SalesDocumentsApiModule } from './sales-documents/sales-documents-api.module';
import { UsersApiModule } from './users/users.module';
import { SystemModule } from './system/system.module';
import { McpModule } from './mcp/mcp.module';
import { MailerApiModule } from './mailer/mailer.module';
import { AnalyticsApiModule } from './analytics/analytics.module';
import { AnalyticsTrustApiModule } from './analytics-trust/analytics-trust.module';
import { CatalogTrustApiModule } from './catalog-trust/catalog-trust.module';
import { FulfillmentApiModule } from './fulfillment/fulfillment-api.module';
import { FulfillmentAuthorityApiModule } from './fulfillment-authority/fulfillment-authority.module';
import { ReturnActionsApiModule } from './returns/return-actions.module';
import { ReturnsReadApiModule } from './returns/returns-read.module';
import { AutomationApiModule } from './automation/automation-api.module';
import { CurrencyApiModule } from './currency/currency.module';
import { OperationalSettingsApiModule } from './operational-settings/operational-settings.module';
import { RequestPriorityModule } from './http/request-priority.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    RequestPriorityModule, // Global APP_INTERCEPTOR: classifies interactive requests for rate-limit priority (#1810)
    DatabaseModule,
    RedisConfigModule,
    CacheModule,
    AppInfoModule, // Runtime product + API version surface for GET /v1/health (#1133)
    HealthModule,
    AuthModule,
    IdentifierMappingModule,
    // #2327: registers the returns ORM entities + repository. No API surface
    // yet (#2334) — imported so the provider graph is proven at boot rather
    // than first exercised by whichever wave adds the first consumer.
    ReturnsModule,
    // #2358: registers the automation ORM entities + rule repository. No API
    // surface yet (#2363) — imported so the provider graph is proven at boot,
    // and so the two writer-less tables (#2360's firings, #2385's runs) are
    // built by the integration harness rather than only by the migration.
    AutomationModule,
    // #2392: registers the three fulfillment_* ORM entities + the work
    // repository. No API surface yet (#2406) — imported so the provider graph
    // is proven at boot, and so the tables are built by the integration harness
    // (autoLoadEntities + synchronize) rather than only by the migration.
    FulfillmentModule,
    CustomersModule, // Import CustomersModule for customer identity resolution and projections
    IntegrationsModule,
    WebhooksModule,
    SyncModule,
    InventoryModule,
    OrdersModule,
    ProductsApiModule,
    CustomersApiModule,
    ListingsApiModule,
    CursorsModule,
    MappingsApiModule,
    ContentModule, // Product content draft buffer + reconcile + publish (#338)
    InvoicingModule, // Invoicing domain foundation — port + record + repo (#751, ADR-026)
    FiscalizationModule, // Fiscalization domain foundation — port + record + repo (#1908, ADR-042)
    CoreAiModule, // Editable prompt-template storage + render service (#341)
    AiApiModule, // REST surface for prompt templates (#341)
    CoreMailerModule, // DB-backed mailer/SMTP settings resolution (#1643)
    MailerApiModule, // Admin REST surface for mailer/SMTP settings (#1643)
    CoreAnalyticsModule, // DB-backed PostHog analytics settings resolution (#1685)
    AnalyticsApiModule, // Admin REST surface for PostHog analytics settings (#1685)
    AnalyticsTrustApiModule, // GET /analytics/trust — data-trust snapshot for the /analytics page (#1982)
    CatalogTrustApiModule, // GET /connections/:id/catalog-trust — master rung + reconcile recency (#2258)
    FulfillmentApiModule, // /fulfillment/works — operator worklist, supportedActions + optimistic token (#2406)
    FulfillmentAuthorityApiModule, // /fulfillment-authority — who decides what + presets (#2353)
    ReturnActionsApiModule, // Every return WRITE: decline (#2333) plus the custody,
    // money and correction-proposal routes (#2376)
    ReturnsReadApiModule, // GET /returns[, /:id, /ingestion-availability] — returns reads (#2334)
    // /automations — rule CRUD, the closed vocabulary, the §5.6a dry run and the
    // per-rule fired log (#2363). Imports OrdersModule as well as AutomationModule:
    // the dry run composes both, and only an app-level module may.
    AutomationApiModule,
    ContentApiModule, // REST surface for product content editor + AI suggest (#339 + #342)
    ShippingApiModule, // Shipment read + command HTTP API (#846); imports core ShippingModule (#763/#835)
    UsersApiModule, // User management: list, approve/reject pending, role + status ops (#1125)
    InvoicingApiModule, // Invoicing issue/read HTTP API (#1119); UPO download endpoint (#1224, epic #1142 C15)
    FiscalizationApiModule, // Fiscal registration trigger + read + reconcile HTTP API (#1908, ADR-042)
    SalesDocumentsApiModule, // Country-agnostic sales-document rule engine HTTP API (#2170, ADR-041 dec. 5)
    SystemModule, // Server-driven runtime config (demoMode) via GET /system/config (#1127)
    McpModule, // MCP Resource-Server auth (PATs) + Streamable-HTTP ingress (#1486, ADR-034)
    CurrencyApiModule, // Reporting-currency settings HTTP API (#2126, ADR-040)
    OperationalSettingsApiModule, // Operator-settable sweep budgets + deletion-audit cadence (#2651)
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
