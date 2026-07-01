/**
 * Global Setup for API Integration Tests
 *
 * Starts the Postgres + Redis Testcontainers in the Jest **main process**
 * realm (harness-only, no AppModule import — mirrors teardown.ts's existing
 * constraint) so `teardown.ts`'s `globalTeardown` can stop the same
 * container handles it started. Without this, containers were started
 * lazily inside int-specs (a worker/VM realm with its own `globalThis`),
 * leaving `globalTeardown`'s `stopContainers()` call a no-op (#1285).
 *
 * Mirrors `apps/worker/test/integration/setup-global.ts`. The per-suite
 * `getTestHarness()` call still runs later inside each int-spec file; its
 * lazy `startContainers()` call detects the env vars this hook already set
 * and reuses them instead of booting a second container pair — see
 * `libs/test-kit/src/containers.ts`'s `CONTAINERS_PRIMED_ENV_VAR`.
 *
 * @module apps/api/test/integration
 */
import { startContainers } from '@openlinker/test-kit';

export default async function globalSetup(): Promise<void> {
  await startContainers();
}
