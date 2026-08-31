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
 * **Why this asserts BEHAVIOUR and not a class identity (#2711).** Until #2711
 * the gate read `expect(dispatcher).toBeInstanceOf(AutomationDispatchService)`.
 * #2362 then bound the token to `AutomationIrreversibleGateService`, which
 * **decorates** the real dispatcher — it partitions the matched rules and hands
 * every survivor to `AutomationDispatchService` unchanged. The binding was
 * correct and the assertion still went red: an identity check **cannot survive a
 * legitimate decoration**. Nor could it survive in the other direction — a class
 * merely *named* `AutomationDispatchService` would satisfy it while doing
 * nothing. So the property is asserted where it actually lives, in what the
 * token DOES:
 *
 * - an inert placeholder records no run at all           → test 1 fails;
 * - a binding that bypasses #2362's gate runs both rules → test 2 fails.
 *
 * Do not "simplify" either test back to `toBeInstanceOf`. That is the check
 * that cannot fail, and it is what #2711 removed.
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
  AutomationRule,
} from '@openlinker/core/automation';
import type {
  AutomationRunRecord,
  IAutomationDispatchService,
  IAutomationRunRecorderService,
} from '@openlinker/core/automation';
import { ORDER_LIFECYCLE_RELAY_SERVICE_TOKEN } from '@openlinker/core/orders';

const NOW = new Date('2026-08-31T10:00:00.000Z');

/**
 * A rule carrying one IRREVERSIBLE step (A1). Named for that role rather than
 * for its payload: test 2 depends on the irreversibility, not on documents.
 *
 * A1 is parameterless and, in this build, resolves to
 * `UnavailableActionExecutorService` (`automation-action-executor.registry.ts`),
 * so the step is deterministic and performs no I/O — no mailer, no relay, no
 * outbound call — while still proving the dispatcher's step loop ran. Test 1
 * PINS that inertness; see the comment there.
 *
 * `triggerConfig` is a real `EmptyTriggerConfig` (`{}`), which is what
 * `order.packed` carries; no cast is needed.
 */
function irreversibleRule(id: string): AutomationRule {
  return new AutomationRule(
    id,
    `Rule ${id}`,
    'order.packed',
    {},
    [],
    [{ action: 'issue-sales-document' }],
    `hash-${id}`,
    true,
    NOW,
    null,
    null,
    null,
    NOW,
    NOW
  );
}

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

  // LOAD-BEARING, not hygiene. The "resolves the run-recorder seam" test below
  // resolves the SAME container singleton these two spy on, and runs after
  // them — it is honest only because the restore happened. Do not tidy this
  // into a `beforeAll`, or that test starts observing a stub.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * Observe the dispatch through the container's own recorder singleton, with
   * the write stubbed: the seam every outcome already reports through, so a
   * dispatch that ran is visible without persisting an `automation_runs` row
   * for a rule that was never inserted.
   *
   * **Why ONE spy can see BOTH branches**, which is what the two tests below
   * depend on: `AUTOMATION_RUN_RECORDER_TOKEN` is the single seam the
   * dispatcher reports a run through AND the gate reports a `blocked` verdict
   * through (#2362 property 3). So "did this dispatch reach the real
   * dispatcher, or was it blocked short of it" is answerable from one
   * observation point, with no second write path that could disagree.
   */
  function spyOnRecorder(): jest.SpyInstance<Promise<void>, [AutomationRunRecord]> {
    const recorder = harness.get<IAutomationRunRecorderService>(AUTOMATION_RUN_RECORDER_TOKEN);
    return jest.spyOn(recorder, 'record').mockResolvedValue(undefined);
  }

  it('dispatches a surviving rule through the REAL dispatcher, not an inert placeholder', async () => {
    // One rule cannot collide with itself, so it must survive #2362's gate and
    // reach the dispatcher. An inert binding records nothing at all.
    const record = spyOnRecorder();
    const rule = irreversibleRule('rule-survivor');

    await harness.get<IAutomationDispatchService>(AUTOMATION_DISPATCH_SERVICE_TOKEN).dispatch({
      trigger: 'order.packed',
      facts: { subjectKind: 'order', subjectId: 'ol_order_2711' },
      matchedRules: [rule],
      now: NOW,
    });

    expect(record).toHaveBeenCalledTimes(1);
    const run = record.mock.calls[0][0];
    expect(run.rule.id).toBe('rule-survivor');
    // Steps exist only if the dispatcher's own step loop ran over the rule's
    // actions. A `blocked` verdict records an empty `steps` array by contract.
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].action).toBe('issue-sales-document');
    // PIN, not decoration. This test executes a REAL executor chain for an
    // IRREVERSIBLE action; it is safe only because A1 currently resolves to
    // `UnavailableActionExecutorService`, which always reports `failed`. When
    // A1 lands (#2361 — the gate service's docblock says it "arms the moment
    // A1/A2 land") this assertion breaks and a human decides, instead of the
    // boot suite silently issuing a fiscal document with every other assertion
    // still green. Same rule as the `resolve_category` pin in
    // engineering-standards § MCP tools: a latent write in the chain gets
    // pinned so wiring it fails the build.
    expect(run.steps[0].status).toBe('failed');
    // Kept although the two assertions above already exclude it (a `blocked`
    // verdict records `steps: []`): on a hard gate, a failure message that
    // names `blocked` explicitly beats one assertion fewer. A runtime check is
    // also not dropped merely because something else currently implies it —
    // the implication can be widened away silently, and then this was the only
    // thing standing.
    expect(run.outcome).not.toBe('blocked');
  });

  it('blocks colliding irreversible rules — #2362s gate is composed in, not bypassed', async () => {
    // Two rules claiming the same irreversible action: the gate refuses BOTH
    // (ADR-041 §6 — it never picks). A binding that resolved straight to
    // `AutomationDispatchService` would run both and issue two documents.
    //
    // DELIBERATELY NOT SYMMETRIC with test 1: this test needs no inertness pin
    // and must not be given one. The gate blocks both rules by construction, so
    // no executor is ever reached and there is no latent write to pin. Adding a
    // step assertion here would assert something that cannot happen.
    const record = spyOnRecorder();

    await harness.get<IAutomationDispatchService>(AUTOMATION_DISPATCH_SERVICE_TOKEN).dispatch({
      trigger: 'order.packed',
      facts: { subjectKind: 'order', subjectId: 'ol_order_2711_collision' },
      matchedRules: [irreversibleRule('rule-a'), irreversibleRule('rule-b')],
      now: NOW,
    });

    expect(record).toHaveBeenCalledTimes(2);
    for (const [run] of record.mock.calls) {
      expect(run.outcome).toBe('blocked');
      // Nothing ran, so nothing may be reported as having run.
      expect(run.steps).toHaveLength(0);
    }
  });

  it('resolves the run-recorder seam #2385 will replace', () => {
    expect(harness.get(AUTOMATION_RUN_RECORDER_TOKEN)).toBeDefined();
  });

  it('registers an executor for EVERY declared action', () => {
    // A rule may be saved for any of the six (#2359 legality permits it), so an
    // uncovered action would fire silently rather than reporting why it cannot.
    const registry = harness.get<AutomationActionExecutorRegistry>(
      AutomationActionExecutorRegistry
    );
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
