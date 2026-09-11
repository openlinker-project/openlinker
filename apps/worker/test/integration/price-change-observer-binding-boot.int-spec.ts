/**
 * Price-change observer binding — worker boot integration test (#3143/#3159, ADR-072)
 *
 * `PRICE_CHANGE_OBSERVER_TOKEN` (owned by `@openlinker/core/products`) is
 * injected `@Optional()` into `MasterProductSyncService` — deliberately,
 * unlike `FULFILLMENT_ROUTER_RESOLVER_TOKEN` (#2408), because this feature is
 * genuinely opt-in per host (see that port's docblock). But `@Optional()` is
 * exactly what makes a mis-wire silent: a dropped `exports` line, a wrong
 * module import, or the binding module never loading at all all produce "the
 * feature does nothing", and lint/type-check/every unit test stay green
 * either way — `master-product-sync.service.spec.ts`'s "never reads previous
 * prices when no observer is wired" case actively asserts the degraded path
 * is silent. This file is the ONLY thing that can catch that class of
 * mistake for the worker, which is where every production caller of
 * `syncFromMasterByExternalId(s)` actually runs (`apps/api` only enqueues the
 * jobs, it never executes them — see the API-side comment in
 * `apps/api/src/app.module.ts` and its sibling boot spec, which asserts the
 * OPPOSITE: that this token is intentionally NOT bound there).
 *
 * Note (#786): `apps/worker/test/**` is excluded from `pnpm lint` and
 * `pnpm type-check`, so this file compiles only under ts-jest at integration
 * time. A green lint/type-check says nothing about it.
 *
 * @module apps/worker/test/integration
 */
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  PRICE_CHANGE_OBSERVER_TOKEN,
  ProductsModule,
} from '@openlinker/core/products';
import type { IMasterProductSyncService, PriceChangeObserverPort } from '@openlinker/core/products';
import { PRICE_CHANGE_DETECTION_SERVICE_TOKEN } from '@openlinker/core/listings';
import { PriceChangeDetectionService } from '@openlinker/core/listings/services';

import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('Price-change observer binding — worker (#3143/#3159)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('boots the real worker container with the binding in place', () => {
    expect(harness).toBeDefined();
  });

  it('resolves PRICE_CHANGE_OBSERVER_TOKEN from ProductsModule — the consumer, not just the token', () => {
    // `ProductsModule` is where `MasterProductSyncService` (the `@Optional()`
    // consumer) is declared, so this is where the binding actually has to
    // resolve from — the same reasoning as `fulfillment-router-binding-boot`.
    const observer = harness
      .getAppContext()
      .select(ProductsModule)
      .get<PriceChangeObserverPort>(PRICE_CHANGE_OBSERVER_TOKEN);

    expect(observer).toBeDefined();
    expect(typeof observer.onMasterPriceChanged).toBe('function');
  });

  it('rebinds to the SAME PriceChangeDetectionService singleton, not a distinct instance', () => {
    // `useExisting` is the mechanism the binding module relies on — this
    // proves it actually rebound rather than constructing a second instance
    // that would silently diverge from the one the rest of `listings` uses.
    const observer = harness
      .getAppContext()
      .select(ProductsModule)
      .get<PriceChangeObserverPort>(PRICE_CHANGE_OBSERVER_TOKEN);
    const detectionService = harness
      .getAppContext()
      .get<PriceChangeDetectionService>(PRICE_CHANGE_DETECTION_SERVICE_TOKEN);

    expect(observer).toBeInstanceOf(PriceChangeDetectionService);
    expect(observer).toBe(detectionService);
  });

  it('constructs MasterProductSyncService with the observer satisfied', () => {
    // The consumer itself, constructed successfully — not merely "a provider
    // exists somewhere in the graph".
    const service = harness
      .getAppContext()
      .select(ProductsModule)
      .get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN);
    expect(service).toBeDefined();
    expect(typeof service.syncFromMasterByExternalId).toBe('function');
  });
});
