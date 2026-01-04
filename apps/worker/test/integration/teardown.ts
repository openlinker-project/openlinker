/**
 * Global Teardown for Worker Integration Tests
 *
 * Stops test infrastructure (containers only). No Nest imports.
 * This is separate from the test harness that closes Nest app context.
 *
 * @module apps/worker/test/integration
 */
import { stopHarness } from './harness';

/**
 * Global teardown hook
 *
 * Called by Jest after all tests complete. Stops containers.
 * No Nest imports - avoids cross-app dependency resolution issues.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    await stopHarness();
  } catch (error) {
    // Log error but don't fail teardown - cleanup errors shouldn't fail the test suite
    console.error('Error during global teardown (non-fatal):', error);
  }
}

