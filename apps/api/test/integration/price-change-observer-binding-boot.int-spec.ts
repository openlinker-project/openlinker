/**
 * Price-change observer binding — API boot integration test (#3143/#3159, ADR-072)
 *
 * The API host deliberately does NOT bind `PRICE_CHANGE_OBSERVER_TOKEN`
 * (owned by `@openlinker/core/products`) — see the comment in
 * `apps/api/src/app.module.ts` where the binding module used to be imported.
 * `MasterProductSyncService`'s only production callers (`syncFromMaster*`)
 * are the worker's `master.product.sync*` job handlers; the API process only
 * ENQUEUES those jobs and never executes them, so wiring the observer here
 * would be dead — and an earlier version of this wiring carried a docblock
 * claiming a "manually-triggered master-product-sync from the API surface",
 * which does not exist anywhere in `apps/api/src` (verified by grep).
 *
 * This file pins BOTH halves of that decision against the real container:
 * the token stays unresolvable here, and — the more important half — the
 * `@Optional()` injection still lets `MasterProductSyncService` construct
 * cleanly with no observer at all, which is what makes the omission safe
 * rather than merely convenient. See the worker's sibling
 * `price-change-observer-binding-boot.int-spec.ts` for the host where the
 * binding is real.
 *
 * @module apps/api/test/integration
 */
import {
  MASTER_PRODUCT_SYNC_SERVICE_TOKEN,
  PRICE_CHANGE_OBSERVER_TOKEN,
  ProductsModule,
} from '@openlinker/core/products';
import type { IMasterProductSyncService } from '@openlinker/core/products';

import { getTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

describe('Price-change observer binding — API (#3143/#3159)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('boots the real API container with no price-change observer bound', () => {
    expect(harness).toBeDefined();
  });

  it('does NOT resolve PRICE_CHANGE_OBSERVER_TOKEN on this host — the deliberate omission', () => {
    expect(() =>
      harness.getApp().select(ProductsModule).get(PRICE_CHANGE_OBSERVER_TOKEN)
    ).toThrow();
  });

  it('still constructs MasterProductSyncService — the @Optional() degrade actually works at boot', () => {
    const service = harness
      .getApp()
      .select(ProductsModule)
      .get<IMasterProductSyncService>(MASTER_PRODUCT_SYNC_SERVICE_TOKEN);

    expect(service).toBeDefined();
    expect(typeof service.syncFromMasterByExternalId).toBe('function');
  });
});
