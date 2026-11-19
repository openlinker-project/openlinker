/**
 * Shopify plugin - worker host boot (#3974, #4100 review)
 *
 * The worker composes the plugin separately (`apps/worker/src/plugins.ts`),
 * and it is the worker that runs Shopify jobs: it needs the manifest and the
 * factory to resolve adapters, the retry and auth-failure classifiers to
 * decide what a failed job does, and the scheduler tasks (orders poll,
 * fulfilment status sync, the two returns passes). A DI or registry mistake in
 * the hand-written `ShopifyIntegrationModule` shows only when the real
 * container boots, so this file boots it and reads those registrations back.
 *
 * Note (#786): `apps/worker/test/**` is excluded from `pnpm lint` and
 * `pnpm type-check`, so this file compiles only under ts-jest at integration
 * time.
 *
 * @module apps/worker/test/integration
 */
import type { AdapterMetadata } from '@openlinker/core/integrations';
import { ADAPTER_REGISTRY_TOKEN } from '@openlinker/core/integrations';
import type {
  AuthFailureClassifierRegistryService,
  RetryClassifierRegistryService,
  SchedulerTaskRegistryService,
} from '@openlinker/core/sync';
import {
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
  SCHEDULER_TASK_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { SHOPIFY_ADAPTER_KEY, SHOPIFY_PLATFORM_TYPE } from '@openlinker/integrations-shopify';

import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';

describe('Shopify plugin - worker host boot (#3974)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Set before the container boots and not left to a sibling spec, so this
    // file can be run on its own (the `oms-module-boot.int-spec.ts` precedent).
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function get<T>(token: symbol): T {
    return harness.getAppContext().get<T>(token, { strict: false });
  }

  it('should register the Shopify manifest in the adapter registry', async () => {
    const adapters = await get<{ listAdapters: () => Promise<AdapterMetadata[]> }>(
      ADAPTER_REGISTRY_TOKEN
    ).listAdapters();
    const shopify = adapters.find((adapter) => adapter.adapterKey === SHOPIFY_ADAPTER_KEY);

    expect(shopify).toBeDefined();
    expect(shopify?.platformType).toBe(SHOPIFY_PLATFORM_TYPE);
  });

  it('should register the retry and auth-failure classifiers', () => {
    expect(
      get<RetryClassifierRegistryService>(RETRY_CLASSIFIER_REGISTRY_TOKEN).has(SHOPIFY_ADAPTER_KEY)
    ).toBe(true);
    expect(
      get<AuthFailureClassifierRegistryService>(AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN).has(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBe(true);
  });

  it('should register the Shopify scheduler tasks', () => {
    const registry = get<SchedulerTaskRegistryService>(SCHEDULER_TASK_REGISTRY_TOKEN);

    for (const taskId of [
      'shopify-orders-poll',
      'shopify-fulfillment-status-sync',
      'shopify-returns-poll',
      'shopify-returns-status-sync',
    ]) {
      expect(registry.has(taskId)).toBe(true);
    }
  });
});
