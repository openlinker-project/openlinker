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
import { VersioningType } from '@nestjs/common';
import { createIntegrationTestHarness } from '@openlinker/test-kit';
import { AppModule } from '../../src/app.module';
import { API_VERSION } from '../../src/app-info/app-info.types';
import { CapabilityNotSupportedFilter } from '../../src/common/filters/capability-not-supported.filter';
import { ConnectionExceptionFilter } from '../../src/common/filters/connection-exception.filter';
import { InventoryLocationExceptionFilter } from '../../src/common/filters/inventory-location-exception.filter';
import { TaxonomySourceUnavailableFilter } from '../../src/common/filters/taxonomy-source-unavailable.filter';
import { AvailabilityUnknownFilter } from '../../src/common/filters/availability-unknown.filter';
import { ReturnsExceptionFilter } from '../../src/common/filters/returns-exception.filter';
import { AutomationExceptionFilter } from '../../src/common/filters/automation-exception.filter';

const harness = createIntegrationTestHarness({
  imports: [AppModule],
  // Mirror `main.ts`'s global exception filters so int-specs see the same
  // HTTP status mapping the running app does (domain exceptions →
  // 400/404/409/422/503 rather than a default 500). The list is the FULL set
  // main.ts registers — a partial mirror makes an int-spec assert a 500 the
  // running app never returns, which is a passing test about the wrong app.
  configureApp: (app) => {
    app.useGlobalFilters(
      new CapabilityNotSupportedFilter(),
      new ConnectionExceptionFilter(),
      new TaxonomySourceUnavailableFilter(),
      new InventoryLocationExceptionFilter(),
      new AvailabilityUnknownFilter(),
      new ReturnsExceptionFilter(),
      new AutomationExceptionFilter()
    );
    // Mirror main.ts's URI versioning (#1133) so int-specs exercise the same
    // `/v1` routing prod serves. Only the version-neutral routes (the `/webhooks`
    // ingress and the root `/`) stay reachable without the prefix.
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });
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
    // inventory_locations (#2313) — operator-authored locations. Like
    // category_mappings and fulfillment_routing_rules, its FK lives in the
    // migration rather than the ORM decorators, so the synchronize-built test
    // schema has nothing to cascade from `connections`. And even in a
    // migration-built schema that FK is ON DELETE SET NULL, which CLEARS the
    // column rather than removing the row — deliberately, since an operator's
    // warehouse outlives the integration. Either way nothing removes these rows,
    // so truncate explicitly or a location leaks into the next case and collides
    // on UQ_inventory_locations_code.
    'inventory_locations',
    'order_records',
    // order_line_items (#1985) — the per-line analytics projection. No
    // ORM/migration FK to order_records (plain indexed text column, same
    // choice as invoice_records/refund_records), so nothing cascades from
    // order_records; truncate explicitly or a prior case's rows leak into a
    // later case's aggregate.
    'order_line_items',
    // offer_status_snapshots (#816) — connection-scoped marketplace publication
    // status. No ORM/migration FK to connections, so nothing cascades; truncate
    // explicitly so the Erli offers-status reconciliation case (#991) starts clean.
    'offer_status_snapshots',
    // offer_commercial_snapshots (#2024) — connection-scoped channel-side price
    // + quantity, written by the same status-sync pass. No ORM/migration FK to
    // connections, so nothing cascades; truncate explicitly. No spec writes to
    // it today (the Erli vertical slice drives the sync, but its fixtures carry
    // no price/stock, so every observation is both-null and skipped) - listed
    // ahead of the first spec that does, since a table with no FK is invisible
    // to the cascade closure and would leak silently.
    'offer_commercial_snapshots',
    // listing_creation_records (#1042) — variant- + connection-scoped shop
    // publish attempts. No ORM/migration FK, so nothing cascades from
    // connections; truncate explicitly so each shop-publish case starts clean.
    'listing_creation_records',
    // invoice_records (#751) — order- + connection-scoped invoicing projection.
    // No ORM/migration FK; truncate explicitly so each invoicing case (incl.
    // the (connectionId, idempotencyKey) dedup assertion) starts clean.
    'invoice_records',
    // fiscal_registration_records (#1908) — order- + connection-scoped
    // fiscalization projection. Its migration declares NO FK by design (same
    // choice as invoice_records), so the table sits outside the CASCADE closure
    // `truncateTables` walks and `resetTestHarness()` would never clear it;
    // rows would then leak across cases and collide on
    // UQ_fiscal_registration_records_connection_idempotency. Truncate explicitly.
    'fiscal_registration_records',
    // refund_records (#2036) — order-scoped refund-capture projection. No
    // ORM/migration FK to order_records (plain indexed text column, matching
    // the invoice_records precedent); truncate explicitly so each refund case
    // starts clean.
    'refund_records',
    // return_lines / returns (#2327) — the OL-owned return aggregate. The ONE
    // FK is return_lines -> returns (ON DELETE CASCADE); neither
    // sourceConnectionId nor internalOrderId carries one (the refund_records
    // precedent), so nothing cascades in from connections or order_records and
    // `truncateTables`' CASCADE walk would never reach either table. Listed
    // child-first for readability — the cascade makes the order immaterial.
    'return_lines',
    'returns',
    // order_changes (#2333) — the ADR-044 change-proposal record. No FK to
    // order_records (the refund_records precedent of an indexed reference by
    // value), so nothing cascades in and `truncateTables`' CASCADE walk would
    // never reach it; truncate explicitly or a proposal from one case still
    // holds its target's slot in the next.
    'order_changes',
    // order_holds (#2338) — the OL-owned hold record. Same shape as
    // order_changes above: no FK to order_records (the refund_records precedent
    // of an indexed reference by value), so nothing cascades in and
    // `truncateTables`' CASCADE walk would never reach it. Truncate explicitly
    // or a hold from one case still holds its order's slot in the next — and
    // because the unique index is partial on OPEN rows, that leak surfaces as a
    // spurious `OrderAlreadyOnHoldError` in an unrelated spec.
    'order_holds',
    // automation_* (#2358) — the OMS automation v1 storage. NOTHING here
    // carries an FK: not runs/firings -> automation_rules (a deleted rule must
    // neither destroy its history nor be blocked by it), and not subjectId ->
    // order_records (the order_changes precedent of an indexed reference by
    // value). `truncateTables`' CASCADE walk therefore reaches none of the
    // three; truncate explicitly, or a firing recorded by one case still
    // suppresses that (rule, subject) pair for the next — which is exactly the
    // at-most-once behaviour the table exists to provide, and exactly the
    // wrong behaviour between test cases.
    'automation_runs',
    'automation_trigger_firings',
    'automation_rules',
    // destination_categories (#1979) — the taxonomy projection. Marketplace
    // rows are owner-keyed with NO connectionId, so nothing cascades from
    // connections; truncate explicitly or an owner tree leaks between cases.
    'destination_categories',
    // exchange_rates (#2123) — the shared, connection-less reference-rate
    // registry. Its natural key is (source, pair, rateDate) with a unique
    // index and no FK anywhere, so nothing cascades into it; truncate
    // explicitly or a row registered by one case is still there for the next,
    // and the get-or-create int-spec counts rows.
    'exchange_rates',
    // reporting_currency_setting (#2123) — the singleton system setting. No
    // FK, so it never cascades; a row written by one case would otherwise
    // change what every later case resolves as the reporting currency.
    'reporting_currency_setting',
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
    // mcp_tokens FKs into users (#1486). Like connection_carrier_mappings and
    // fulfillment_routing_rules, that FK lives in the migration rather than the
    // ORM decorators, so the synchronize-built test schema has nothing to
    // cascade from `users` — truncate it explicitly or tokens leak between cases.
    'mcp_tokens',
    'product_variants',
    'products',
    // shipments (#763 / #835) — order- + connection-scoped; truncate before
    // connections so the dispatch int-spec starts each case with no rows.
    'shipments',
    // category_mappings is connection-scoped operator config (#1036). Its FKs
    // live in the migration rather than the ORM decorators, so the
    // synchronize-built test schema has nothing to cascade from `connections`
    // — without this a mapping written by one case is still there for the
    // next, and the MCP write-refusal assertion (#1488) counts rows.
    'category_mappings',
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

    // PII hash salt is required at boot by getPiiConfig() (it throws when
    // unset), so the AppModule cannot instantiate CustomerProjectionService —
    // and thus the whole harness can't boot — without it. CI supplies it via
    // the runner env; default to an obviously-fake test value so the suite is
    // self-contained on machines that don't export it. An externally-provided
    // salt still wins (this only fills the gap).
    OL_PII_HASH_SALT: process.env.OL_PII_HASH_SALT ?? 'integration-test-pii-salt',

    // Disable all background schedulers in integration tests.
    //
    // Since #2279 (ADR-051) the api hosts NO scheduler at all — it moved to
    // the worker's `scheduler` role — so these are belt-and-braces rather
    // than load-bearing here: they keep a plugin that reads its own gate at
    // registration time quiet, and they document the full task inventory in
    // one place. Scheduler behaviour is exercised in the worker's own specs
    // (`apps/worker/src/scheduler/__tests__`), where `SchedulerService.start()`
    // can be invoked directly and `SchedulerTaskRegistryService` remains the
    // seam for ad-hoc tasks (#584).
    OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_PRESTASHOP_POLL_SCHEDULER_ENABLED: 'false',
    OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED: 'false',
    OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    // Erli offer-status reconciliation scheduler (#989). Explicitly disabled to
    // match the file's "disable all background schedulers" intent (#991); the
    // offers int-spec drives OfferStatusSyncService directly regardless.
    OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
    // Erli orders-poll scheduler (#993). The API app boots the real Erli plugin,
    // which registers the `erli-orders-poll` cron; left enabled it fires in-suite
    // against an empty inbox, keeps the event loop alive (Jest hang), and races
    // the deterministic direct-invocation scenarios. The orders int-spec (#998)
    // drives ingestion directly, so disable it like every other scheduler.
    OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED: 'false',
    OL_INVENTORY_SYNC_ENABLED: 'false',
    OL_PRODUCT_SYNC_ENABLED: 'false',
    // Deletion reconciliation (#2222). Unlike the delta pass, this task defaults
    // ON, so it is the one core sweep that must be named here explicitly - left
    // enabled it fires against the empty integration database and keeps the event
    // loop alive, which is the Jest hang this whole block exists to prevent.
    OL_MASTER_PRODUCT_RECONCILE_ENABLED: 'false',
    // Connection-provenance backfill (#2317). Also defaults ON, for the same
    // reason and with the same consequence - left enabled it ticks against the
    // integration database every 5 minutes and keeps the event loop alive.
    OL_INVENTORY_PROVENANCE_BACKFILL_ENABLED: 'false',
    OL_PICKUP_POINT_REFRESH_ENABLED: 'false',
    OL_REGULATORY_RECONCILE_ENABLED: 'false',
    OL_OFFLINE_RESUBMIT_ENABLED: 'false',
    OL_PENDING_RECOVERY_ENABLED: 'false',
    OL_TAXONOMY_SYNC_ENABLED: 'false',

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
