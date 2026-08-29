/**
 * Automation Action Dispatch — DI Boot / Container Integration Test (#2361).
 *
 * HARD GATE, and the sibling of `automation-emission-boot.int-spec.ts`. That
 * spec exists because a missing `AutomationModule` import shipped green through
 * `pnpm lint`, `pnpm type-check`, `pnpm check:invariants` and every unit suite —
 * NestJS DI wiring is invisible to the TypeScript compiler, so booting the real
 * container is the only automated guard.
 *
 * #2361 replaced the dispatch binding, so this asserts the SWAP actually took in
 * the worker: an unreplaced binding would leave every automation firing logged
 * and inert, which reads exactly like a rule that did not match.
 *
 * **What this spec deliberately does NOT assert**: that every executor's
 * delegate token resolves. `MAILER_TOKEN` is bound only in `apps/api`, so such
 * an assertion would FAIL on correct behaviour. The worker's missing mailer is
 * an operator-facing `failed` step, covered by the executor unit specs.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import {
  AUTOMATION_DISPATCH_SERVICE_TOKEN,
  AUTOMATION_RUN_RECORDER_TOKEN,
  AutomationActionExecutorRegistry,
  AutomationActionValues,
  AutomationDispatchService,
} from '@openlinker/core/automation';
import { ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN } from '@openlinker/core/orders';

describe('Automation action dispatch — DI boot (HARD GATE, #2361)', () => {
  let harness: WorkerIntegrationTestHarness;

  beforeAll(async () => {
    // Set BEFORE the container boots, and set here rather than relying on a
    // sibling spec — a boot gate that is run-order dependent is a boot gate you
    // cannot run to diagnose the boot it guards.
    process.env.OL_PII_HASH_SALT ??= 'test-salt-for-integration-tests';
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('resolves the REAL dispatcher, not #2360s inert placeholder', () => {
    // The whole point of the #2360 seam was that #2361 is one provider binding.
    // If the swap is missed, every firing logs and does nothing.
    const dispatcher = harness.get(AUTOMATION_DISPATCH_SERVICE_TOKEN);
    expect(dispatcher).toBeInstanceOf(AutomationDispatchService);
  });

  it('resolves the run-recorder seam #2385 will replace', () => {
    expect(harness.get(AUTOMATION_RUN_RECORDER_TOKEN)).toBeDefined();
  });

  it('registers an executor for EVERY declared action', () => {
    // A rule may be saved for any of the six (#2359 legality permits it), so an
    // uncovered action would fire silently rather than reporting why it cannot.
    const registry = harness.get(AutomationActionExecutorRegistry);
    for (const action of AutomationActionValues) {
      expect(registry.resolve(action)).toBeDefined();
    }
  });

  it('resolves the order-lifecycle relay A3 delegates to, with no DI cycle', () => {
    // AutomationModule imports NOTHING from orders — A3 resolves this token
    // lazily via ModuleRef. Resolving it here proves the token is bound in the
    // worker container, which is what that lazy lookup depends on.
    expect(harness.get(ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN)).toBeDefined();
  });
});
