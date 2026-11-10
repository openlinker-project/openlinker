/**
 * AutomationDispatchService specs (#2361)
 */
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import { AutomationActionValues } from '../../../domain/types/automation-action.types';
import type { AutomationAction } from '../../../domain/types/automation-action.types';
import type { AutomationSubjectFacts } from '../../../domain/types/automation-facts.types';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';
import type {
  AutomationRunRecord,
  IAutomationRunRecorderService,
} from '../../interfaces/automation-run-recorder.service.interface';
import type { AutomationActionExecutorRegistry } from '../automation-action-executor.registry';
import { AutomationDispatchService } from '../automation-dispatch.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const CREATED = new Date('2026-09-01T00:00:00.000Z');

const EMAIL: AutomationAction = {
  action: 'send-email',
  recipient: { kind: 'address', address: 'ops@example.com' },
  subject: 's',
  body: 'b',
};
const RELAY: AutomationAction = { action: 'relay-status-to-source' };

const FACTS: AutomationSubjectFacts = { subjectKind: 'order', subjectId: 'ol_order_1' };

function rule(id: string, actions: readonly AutomationAction[]): AutomationRule {
  return new AutomationRule(
    id, `Rule ${id}`, 'order.packed', {} as never, [], actions, 'hash',
    true, CREATED, null, null, null, CREATED, CREATED,
  );
}

/** An executor whose per-action verdicts the test dictates. */
function stubRegistry(
  verdicts: Partial<Record<string, AutomationStepResult['status']>>,
  calls: string[] = [],
): AutomationActionExecutorRegistry {
  const executor = {
    execute: (input: { action: AutomationAction; stepIndex: number }) => {
      calls.push(input.action.action);
      return Promise.resolve({
        stepIndex: input.stepIndex,
        action: input.action.action,
        status: verdicts[input.action.action] ?? 'done',
      } as AutomationStepResult);
    },
  };
  return { resolve: () => executor, coveredActions: () => [] } as unknown as AutomationActionExecutorRegistry;
}

/**
 * A typed capturing recorder. Reading `jest.Mock.mock.calls[0][0]` would type
 * every assertion as `any`, which the lint gate rejects — and rightly: an
 * assertion over `any` cannot fail to compile when the recorded shape changes.
 */
function capturingRecorder(): {
  recorder: IAutomationRunRecorderService;
  runs: AutomationRunRecord[];
  fail: (error: Error) => void;
} {
  const runs: AutomationRunRecord[] = [];
  let failure: Error | null = null;
  return {
    runs,
    fail: (error: Error) => {
      failure = error;
    },
    recorder: {
      // #2363: the contract declares whether firings are persisted. This double
      // only observes, so it answers `false` like the shipped recorder does.
      persistsRuns: false,
      record: (run: AutomationRunRecord): Promise<void> => {
        if (failure) return Promise.reject(failure);
        runs.push(run);
        return Promise.resolve();
      },
    },
  };
}

describe('AutomationDispatchService', () => {
  let recorder: IAutomationRunRecorderService;
  let runs: AutomationRunRecord[];
  let failRecorder: (error: Error) => void;

  beforeEach(() => {
    ({ recorder, runs, fail: failRecorder } = capturingRecorder());
  });

  it('should stop the list at the first failure and record which step failed', async () => {
    const calls: string[] = [];
    const service = new AutomationDispatchService(
      stubRegistry({ 'relay-status-to-source': 'failed' }, calls),
      recorder,
    );

    await service.dispatch({
      trigger: 'order.packed',
      facts: FACTS,
      matchedRules: [rule('a', [EMAIL, RELAY, EMAIL])],
      now: NOW,
    });

    // Step 3 must never run.
    expect(calls).toEqual(['send-email', 'relay-status-to-source']);
    const run = runs[0];
    expect(run.outcome).toBe('failed');
    expect(run.steps.map((step: AutomationStepResult) => step.status)).toEqual([
      'done',
      'failed',
      'skipped',
    ]);
    expect(run.steps[1].stepIndex).toBe(1);
  });

  it('should record the skipped step explicitly rather than omitting it', async () => {
    // §5.6: a silently missing step is indistinguishable from a step that was
    // never configured.
    const service = new AutomationDispatchService(
      stubRegistry({ 'send-email': 'failed' }),
      recorder,
    );

    await service.dispatch({
      trigger: 'order.packed',
      facts: FACTS,
      matchedRules: [rule('a', [EMAIL, RELAY])],
      now: NOW,
    });

    const run = runs[0];
    expect(run.steps).toHaveLength(2);
    expect(run.steps[1]).toMatchObject({ action: 'relay-status-to-source', status: 'skipped' });
  });

  it('should report done when every step ran', async () => {
    const service = new AutomationDispatchService(stubRegistry({}), recorder);
    await service.dispatch({
      trigger: 'order.packed', facts: FACTS, matchedRules: [rule('a', [EMAIL])], now: NOW,
    });
    expect(runs[0].outcome).toBe('done');
  });

  it('should report nothing-to-do only when EVERY step found the work already done', async () => {
    const service = new AutomationDispatchService(
      stubRegistry({ 'send-email': 'nothing-to-do', 'relay-status-to-source': 'nothing-to-do' }),
      recorder,
    );
    await service.dispatch({
      trigger: 'order.packed', facts: FACTS, matchedRules: [rule('a', [EMAIL, RELAY])], now: NOW,
    });
    expect(runs[0].outcome).toBe('nothing-to-do');
  });

  it('should record one run per matched rule, including several carrying the same action', async () => {
    // #2362 composes ITS gate over this service; dispatch never collapses rules.
    const service = new AutomationDispatchService(stubRegistry({}), recorder);
    await service.dispatch({
      trigger: 'order.packed',
      facts: FACTS,
      matchedRules: [rule('a', [EMAIL]), rule('b', [EMAIL])],
      now: NOW,
    });
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.rule.id)).toEqual(['a', 'b']);
  });

  it('should contain an executor throw to its own step and still record the run', async () => {
    const registry = {
      resolve: () => ({ execute: () => Promise.reject(new Error('boom')) }),
      coveredActions: () => [],
    } as unknown as AutomationActionExecutorRegistry;
    const service = new AutomationDispatchService(registry, recorder);

    await expect(
      service.dispatch({
        trigger: 'order.packed', facts: FACTS, matchedRules: [rule('a', [EMAIL])], now: NOW,
      }),
    ).resolves.toBeUndefined();

    const run = runs[0];
    expect(run.outcome).toBe('failed');
    expect(run.steps[0].detail).toContain('boom');
  });

  it('should not let one rule throwing cost its siblings their firing', async () => {
    let seen = 0;
    const registry = {
      resolve: () => ({
        execute: () => {
          seen += 1;
          return seen === 1 ? Promise.reject(new Error('boom')) : Promise.resolve({
            stepIndex: 0, action: 'send-email', status: 'done',
          } as AutomationStepResult);
        },
      }),
      coveredActions: () => [],
    } as unknown as AutomationActionExecutorRegistry;
    const service = new AutomationDispatchService(registry, recorder);

    await service.dispatch({
      trigger: 'order.packed',
      facts: FACTS,
      matchedRules: [rule('a', [EMAIL]), rule('b', [EMAIL])],
      now: NOW,
    });

    expect(runs).toHaveLength(2);
    expect(runs[1].outcome).toBe('done');
  });

  it('should fail the step when this build has no executor for a persisted action', async () => {
    // The registry is keyed from a jsonb column: a rule saved by a newer build
    // reaches here. Never a throw (which would abort sibling rules), never a
    // silent skip.
    const registry = {
      resolve: () => undefined,
      coveredActions: () => [],
    } as unknown as AutomationActionExecutorRegistry;
    const service = new AutomationDispatchService(registry, recorder);

    await service.dispatch({
      trigger: 'order.packed', facts: FACTS, matchedRules: [rule('a', [EMAIL])], now: NOW,
    });

    const run = runs[0];
    expect(run.outcome).toBe('failed');
    expect(run.steps[0].detail).toContain('send-email');
  });

  it('should never let a recorder failure turn a completed firing into a job retry', async () => {
    failRecorder(new Error('db down'));
    const service = new AutomationDispatchService(stubRegistry({}), recorder);
    await expect(
      service.dispatch({
        trigger: 'order.packed', facts: FACTS, matchedRules: [rule('a', [EMAIL])], now: NOW,
      }),
    ).resolves.toBeUndefined();
  });

  it('should keep the action vocabulary and the registry in lockstep', () => {
    // A seventh action must fail to compile in the registry rather than persist
    // as a rule that silently never runs.
    expect([...AutomationActionValues].sort()).toEqual(
      [
        'dispatch-shipment',
        'issue-sales-document',
        'place-hold',
        'relay-status-to-source',
        'release-hold',
        'send-email',
      ].sort(),
    );
  });
});
