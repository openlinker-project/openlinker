/**
 * Global Teardown for Integration Tests
 *
 * Ensures all test containers and resources are cleaned up after all tests complete.
 *
 * @module apps/api/test/integration
 */
import { teardownTestHarness } from './setup';

/**
 * Global teardown hook
 *
 * Called by Jest after all tests complete.
 */
export default async function globalTeardown(): Promise<void> {
  await teardownTestHarness();
}

