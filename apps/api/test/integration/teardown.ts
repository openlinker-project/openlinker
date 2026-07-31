/**
 * Global Teardown for Integration Tests
 *
 * Ensures all test containers are cleaned up after all tests complete.
 * This is harness-only (no AppModule imports) to avoid requiring @openlinker/core dist files.
 *
 * @module apps/api/test/integration
 */
import { stopHarness } from './harness';
import { stopSharedPrestashopContainer } from './helpers/prestashop-container.helper';

/**
 * Global teardown hook
 *
 * Called by Jest after all tests complete.
 * Stops containers (harness-only, no app imports).
 *
 * Note: App resources are cleaned up by individual test harness instances.
 * We don't import setup.ts here to avoid importing AppModule, which would
 * require @openlinker/core dist files to exist.
 */
export default async function globalTeardown(): Promise<void> {
  // Stop containers (harness-only, no app imports)
  await stopHarness();
  // The PrestaShop container shared across specs (#1920) is booted lazily in a
  // worker realm, so its `cleanup` closure is unreachable from here - stop it
  // from the ids that realm left on disk.
  stopSharedPrestashopContainer();
}




