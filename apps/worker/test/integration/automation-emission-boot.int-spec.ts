/**
 * Automation Trigger Emission — DI Boot / Container Integration Test (#2360).
 *
 * HARD GATE. This spec exists because the defect it guards shipped green through
 * `pnpm lint`, `pnpm type-check`, `pnpm check:invariants` and every unit suite:
 * `SyncWorkerModule` provided `AutomationTriggerDeadlineSweepHandler` without
 * importing `AutomationModule`, and Nest module imports are not transitive, so
 * the worker would have failed to boot on the first tick in production.
 *
 * NestJS DI wiring is invisible to the TypeScript compiler. Booting the real
 * container is the only automated guard against a missing module import, an
 * unexported token, an unprovided handler, or a module cycle — the same argument
 * `invoicing-auto-issue-boot.int-spec.ts` makes for its own edge (#1120).
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import {
  AUTOMATION_RULES_SERVICE_TOKEN,
  AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN,
} from '@openlinker/core/automation';
import { ORDER_RECORD_SERVICE_TOKEN } from '@openlinker/core/orders';
import { AutomationTriggerDeadlineSweepHandler } from '../../src/sync/handlers/automation-trigger-deadline-sweep.handler';
import { SyncJobHandlerRegistry } from '../../src/sync/handlers/sync-job-handler.registry';

describe('Automation trigger emission — DI boot (HARD GATE, #2360)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Set BEFORE the container boots. Deliberately not relying on another spec to
    // have set it: `invoicing-auto-issue-boot.int-spec.ts` does exactly that and
    // consequently fails when run alone via `--runTestsByPath` — it passes only
    // because `allegro-masked-email-identity.int-spec.ts` sets the variable and
    // `maxWorkers: 1` leaks it across files. A boot gate that is order-dependent
    // is a boot gate you cannot run to diagnose the boot it guards.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('the real container resolves the deadline-sweep handler', () => {
    // Fails if SyncWorkerModule does not import AutomationModule — the exact
    // defect this spec was written for.
    const handler = harness.get(AutomationTriggerDeadlineSweepHandler);
    expect(handler).toBeInstanceOf(AutomationTriggerDeadlineSweepHandler);
  });

  it('the real container resolves both automation tokens the handler injects', () => {
    expect(harness.get(AUTOMATION_RULES_SERVICE_TOKEN)).toBeDefined();
    expect(harness.get(AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN)).toBeDefined();
  });

  it('the real container resolves OrderRecordService (T5 orders -> automation edge; no DI cycle)', () => {
    // OrderRecordService injects AUTOMATION_TRIGGER_EMISSION_SERVICE_TOKEN to fire
    // T5. Resolving it proves OrdersModule -> AutomationModule wires at runtime and
    // that AutomationModule does NOT import OrdersModule back.
    expect(harness.get(ORDER_RECORD_SERVICE_TOKEN)).toBeDefined();
  });

  it('registers automation.trigger.deadlineSweep so lane coverage holds', () => {
    // `assertFullLaneCoverage` fails boot on any JobTypeValues member with no
    // registered handler+lane; this asserts the registration positively.
    const registry = harness.get(SyncJobHandlerRegistry);
    expect(registry.getHandler('automation.trigger.deadlineSweep')).not.toBeNull();
  });
});
