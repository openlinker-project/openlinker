/**
 * Persisting run recorder tests (#2385)
 *
 * The write path is the only producer of `automation_runs`, so these pin what a
 * firing looks like once written — including the two properties an operator
 * depends on months later: the rule NAME as it fired, and the steps that did not
 * run recorded rather than absent.
 */
import { PersistingAutomationRunRecorder } from '../automation-run-recorder.service';
import { AutomationRule } from '../../../domain/entities/automation-rule.entity';
import type { AutomationRun } from '../../../domain/entities/automation-run.entity';
import type {
  AutomationRunRepositoryPort,
  NewAutomationRun,
} from '../../../domain/ports/automation-run-repository.port';
import type { AutomationStepResult } from '../../../domain/types/automation-step-result.types';
import type { AutomationRunRecord } from '../../interfaces/automation-run-recorder.service.interface';

function makeRule(name: string): AutomationRule {
  return new AutomationRule(
    'rule-1',
    name,
    'order.packed',
    {},
    [],
    [{ action: 'relay-status-to-source' }],
    'hash-1',
    true,
    new Date('2026-08-01T00:00:00.000Z'),
    null,
    null,
    null,
    new Date('2026-08-01T00:00:00.000Z'),
    new Date('2026-08-01T00:00:00.000Z'),
  );
}

function makeRecord(overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    rule: makeRule('Tell the marketplace'),
    trigger: 'order.packed',
    facts: {
      subjectKind: 'order',
      subjectId: 'ol_order_1',
      occurredAt: new Date('2026-08-20T10:00:00.000Z'),
    },
    outcome: 'done',
    steps: [{ stepIndex: 0, action: 'relay-status-to-source', status: 'done' }],
    firedAt: new Date('2026-08-20T10:00:00.000Z'),
    ...overrides,
  } as AutomationRunRecord;
}

describe('PersistingAutomationRunRecorder', () => {
  let repository: jest.Mocked<AutomationRunRepositoryPort>;
  let recorder: PersistingAutomationRunRecorder;
  let saved: NewAutomationRun | undefined;

  beforeEach(() => {
    saved = undefined;
    repository = {
      save: jest.fn().mockImplementation((run: NewAutomationRun) => {
        saved = run;
        return Promise.resolve({ ...run, id: 'run-1' } as unknown as AutomationRun);
      }),
      findRecentByRuleId: jest.fn(),
      findRecentBySubject: jest.fn(),
      findById: jest.fn(),
      findRecent: jest.fn(),
    };
    recorder = new PersistingAutomationRunRecorder(repository);
  });

  it('should declare that it persists runs', () => {
    // The single switch that flips `recordingAvailable`, so an empty log stops
    // reading as "not built yet".
    expect(recorder.persistsRuns).toBe(true);
  });

  it('should write exactly one row per firing', async () => {
    await recorder.record(makeRecord());
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it('should write a row for a firing whose first step failed', async () => {
    await recorder.record(makeRecord({ outcome: 'failed' }));
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(saved?.outcome).toBe('failed');
  });

  it('should freeze the rule name as it fired, so a rename never rewrites history', async () => {
    await recorder.record(makeRecord({ rule: makeRule('Original name') }));
    expect(saved?.ruleName).toBe('Original name');
    expect(saved?.ruleId).toBe('rule-1');
  });

  it('should persist steps VERBATIM, including ones that never ran', async () => {
    // `skipped` is the shipped vocabulary for "an EARLIER step failed, so this
    // one never ran". The AC's operative half is "not as absent" — the step is
    // recorded and distinguishable, which is what an operator needs.
    const steps: AutomationStepResult[] = [
      { stepIndex: 0, action: 'dispatch-shipment', status: 'failed', detail: 'Carrier refused.' },
      { stepIndex: 1, action: 'relay-status-to-source', status: 'skipped' },
    ];
    await recorder.record(makeRecord({ outcome: 'failed', steps }));

    expect(saved?.steps).toHaveLength(2);
    expect(saved?.steps).toEqual(steps);
  });

  it('should carry the subject through so the order timeline can find the run', async () => {
    await recorder.record(makeRecord());
    expect(saved?.subjectKind).toBe('order');
    expect(saved?.subjectId).toBe('ol_order_1');
  });

  it('should write a null collision set for an ordinary firing', async () => {
    // Only a `blocked` run carries one; an empty array would read as "collided
    // with nothing" rather than "no collision was assessed".
    await recorder.record(makeRecord());
    expect(saved?.blockedByRuleIds).toBeNull();
  });

  it('should NOT swallow a repository failure', async () => {
    // `AutomationDispatchService.record` owns the catch, because it is the site
    // that knows re-running the steps is what a propagated error would cost.
    // Catching here too would leave a write failure with no signal at either level.
    repository.save.mockRejectedValueOnce(new Error('db down'));
    await expect(recorder.record(makeRecord())).rejects.toThrow('db down');
  });
});
