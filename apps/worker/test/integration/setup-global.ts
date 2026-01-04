/**
 * Global Setup for Worker Integration Tests
 *
 * Starts test infrastructure (containers only). No Nest imports.
 * This is separate from the test harness that boots Nest app context.
 *
 * @module apps/worker/test/integration
 */
import { startHarness } from './harness';

/**
 * Global setup hook
 *
 * Called by Jest before all tests. Starts containers and sets env vars.
 */
export default async function globalSetup(): Promise<void> {
  await startHarness();
}

