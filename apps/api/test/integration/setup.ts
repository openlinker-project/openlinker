/**
 * Integration Test Harness — apps/api configuration
 *
 * Thin wrapper around `@openlinker/test-kit`'s `createIntegrationTestHarness`
 * factory. Holds the API-specific bits: `AppModule`, the canonical truncate
 * table list, the `/webhooks` raw-body middleware (needed for signature
 * verification), and the `OL_*` feature flags / env-var fixtures we set
 * before container startup.
 *
 * The three singleton accessors (`getTestHarness`, `resetTestHarness`,
 * `teardownTestHarness`) are re-exported so existing int-specs keep their
 * `import ... from './setup'` lines unchanged (#600).
 *
 * @module apps/api/test/integration
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import { createIntegrationTestHarness } from '@openlinker/test-kit';
import { AppModule } from '../../src/app.module';
import { CapabilityNotSupportedFilter } from '../../src/common/filters/capability-not-supported.filter';
import { ConnectionExceptionFilter } from '../../src/common/filters/connection-exception.filter';

const harness = createIntegrationTestHarness({
  imports: [AppModule],
  // Mirror `main.ts`'s global exception filters so int-specs see the same
  // HTTP status mapping the running app does (domain exceptions → 400/404/409
  // rather than a default 500).
  configureApp: (app) => {
    app.useGlobalFilters(new CapabilityNotSupportedFilter(), new ConnectionExceptionFilter());
  },
  configureBodyParser: (app) => {
    // 1) /webhooks: JSON parser with a `verify` hook that captures the raw
    //    request bytes for HMAC signature verification. Must run before any
    //    other body parser so the verify hook fires.
    app.use(
      '/webhooks',
      express.json({
        limit: '256kb',
        verify: (req: express.Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
          req.rawBody = buf;
        },
      })
    );

    // 2) Everything else: plain JSON parser, no raw capture needed.
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true }));

    // 3) cookie-parser: required for refresh-token rotation (#710) so the
    //    /auth/refresh + /auth/logout handlers and CsrfGuard can read
    //    ol_refresh / ol_csrf off req.cookies. Mirrors main.ts.
    app.use(cookieParser());
  },
  tablesToTruncate: [
    // Order matters — child tables first, then parents (FK CASCADE handles
    // the rest but listing in dependency order keeps intent clear).
    'identifier_mappings',
    'sync_jobs',
    'inventory_items',
    'order_records',
    // listing_creation_records (#1042) — variant- + connection-scoped shop
    // publish attempts. No ORM/migration FK, so nothing cascades from
    // connections; truncate explicitly so each shop-publish case starts clean.
    'listing_creation_records',
    // invoice_records (#751) — order- + connection-scoped invoicing projection.
    // No ORM/migration FK; truncate explicitly so each invoicing case (incl.
    // the (connectionId, idempotencyKey) dedup assertion) starts clean.
    'invoice_records',
    // product_content_field FKs to both products + connections, so it goes
    // before them.
    'product_content_field',
    // prompt_templates has no FKs but is part of the AI context.
    'prompt_templates',
    // AI provider singleton + per-provider keys (#451 / #452). Reset between
    // tests so the multi-provider spec sees a clean view per case; the
    // credentials table is shared (webhook secrets etc.) so it is best to
    // truncate it broadly rather than scope to a particular ref prefix.
    'ai_provider_active_setting',
    'integration_credentials',
    // refresh_tokens has FKs into users (#710). Truncate before users
    // so the FK CASCADE doesn't fight the explicit order.
    'refresh_tokens',
    'product_variants',
    'products',
    // shipments (#763 / #835) — order- + connection-scoped; truncate before
    // connections so the dispatch int-spec starts each case with no rows.
    'shipments',
    // fulfillment_routing_rules is connection-scoped config (#832). Listed
    // explicitly because — like connection_carrier_mappings — its FKs live in
    // the migration, not the ORM decorators, so the synchronize-built test
    // schema has no FK to cascade from `connections`.
    'fulfillment_routing_rules',
    'connections',
    'users',
  ],
  env: {
    JWT_SECRET: 'test-secret-for-integration-tests',
    JWT_EXPIRES_IN: '1d',

    // Disable all background schedulers in integration tests. Cron jobs fire
    // against an empty database and keep the Node.js event loop alive,
    // causing Jest to hang after tests complete. If a future int-spec needs
    // to exercise scheduler behaviour, write a `SchedulerTaskConfig` into
    // `SchedulerTaskRegistryService` (or mirror a real Allegro task via
    // `buildAllegroSchedulerTasks`) and re-invoke
    // `SchedulerService.onApplicationBootstrap()` — these env vars were
    // evaluated at boot and cannot be flipped back on mid-test, but the
    // registry is the seam for adding ad-hoc tasks (#584).
    OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_PRESTASHOP_POLL_SCHEDULER_ENABLED: 'false',
    OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED: 'false',
    OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_INVENTORY_SYNC_ENABLED: 'false',
    OL_PRODUCT_SYNC_ENABLED: 'false',

    // Integration tests seed users explicitly via loginAsAdmin / seedUser
    // helpers. Letting BootstrapAdminService also insert a default `admin`
    // user on app.init() causes the first `loginAsAdmin('admin')` call in
    // every suite to collide on the users.username unique constraint
    // (#278). Regression guard: bootstrap-admin-disabled.int-spec.ts.
    OL_BOOTSTRAP_ADMIN_ENABLED: 'false',

    // Force AiIntegrationModule into fake mode for every integration test.
    // The fake adapter (wired by OL_AI_PROVIDER=fake) avoids real outbound
    // LLM calls. ai-provider-settings.int-spec.ts also asserts the
    // "fake mode" branch of /ai-provider-settings (PUT/DELETE return 400,
    // GET returns provider: 'fake') — see #402.
    OL_AI_PROVIDER: 'fake',

    NODE_ENV: 'test',
  },
});

export const { getTestHarness, resetTestHarness, teardownTestHarness } = harness;
export type { IntegrationTestHarness } from '@openlinker/test-kit';
