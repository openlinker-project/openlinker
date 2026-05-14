/**
 * Integration Test Container Lifecycle — apps/api shim
 *
 * Re-exports the framework-neutral container lifecycle from
 * `@openlinker/test-kit` under the legacy `startHarness` / `stopHarness`
 * names so `teardown.ts` (Jest globalTeardown candidate) keeps working
 * without further edits. New code should import `startContainers` /
 * `stopContainers` directly from `@openlinker/test-kit` (#600).
 *
 * @module apps/api/test/integration
 */
export { startContainers as startHarness, stopContainers as stopHarness } from '@openlinker/test-kit';
