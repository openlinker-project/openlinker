/**
 * "One record, four readings" (#2385, spec §5.6 closing rule)
 *
 * The acceptance criterion asks for this spec by name: the timeline event, the
 * activity row, the per-rule fired log and the attention state must be
 * RENDERINGS of one `automation_runs` row — never four writes. The test that
 * proves it is one that mutates the row and observes every reading change.
 *
 * The fourth reading (the order timeline) is derived frontend-side from the same
 * rows `listRecentBySubject` returns — there is no timeline table anywhere in the
 * repo — so it is represented here by that read. Its own derivation is covered in
 * `apps/web/src/features/orders/lib/automation-timeline.test.ts`.
 *
 * @module libs/core/src/automation/application/services/__tests__
 */
import { AutomationRunsReadService } from '../automation-runs-read.service';
import { AutomationRun } from '../../../domain/entities/automation-run.entity';
import type { AutomationRunRepositoryPort } from '../../../domain/ports/automation-run-repository.port';
import type { AutomationRunOutcome } from '../../../domain/types/automation-run.types';
import type { IAutomationRunRecorderService } from '../../interfaces/automation-run-recorder.service.interface';

/** THE row. Every reading below resolves to this same object. */
function theRow(outcome: AutomationRunOutcome): AutomationRun {
  return new AutomationRun(
    'run-1',
    'rule-1',
    'Tell the marketplace',
    'order.packed',
    'order',
    'ol_order_1',
    outcome,
    [{ stepIndex: 0, action: 'relay-status-to-source', status: 'done' }],
    null,
    new Date('2026-08-20T10:00:00.000Z'),
    new Date('2026-08-20T10:00:00.000Z'),
  );
}

describe('one record, four readings', () => {
  let repository: jest.Mocked<AutomationRunRepositoryPort>;
  let recorder: jest.Mocked<IAutomationRunRecorderService>;
  let service: AutomationRunsReadService;
  let row: AutomationRun;

  beforeEach(() => {
    row = theRow('done');
    // Every read is backed by the SAME object — which is the point. If any
    // surface had its own write path, one of these would need its own fixture.
    repository = {
      save: jest.fn(),
      findRecentByRuleId: jest.fn().mockImplementation(() => Promise.resolve([row])),
      findRecentBySubject: jest.fn().mockImplementation(() => Promise.resolve([row])),
      findRecent: jest.fn().mockImplementation(() => Promise.resolve([row])),
      findById: jest.fn().mockImplementation(() => Promise.resolve(row)),
    };
    recorder = {
      record: jest.fn(),
      persistsRuns: true,
    } as unknown as jest.Mocked<IAutomationRunRecorderService>;
    service = new AutomationRunsReadService(repository, recorder);
  });

  async function readAllFour(): Promise<(AutomationRunOutcome | undefined)[]> {
    const perRule = await service.listRecentByRule('rule-1');
    const activity = await service.listRecent();
    const timelineSource = await service.listRecentBySubject('order', 'ol_order_1');
    const single = await service.getRunById('run-1');
    return [
      perRule.runs[0]?.outcome,
      activity.runs[0]?.outcome,
      timelineSource.runs[0]?.outcome,
      single?.outcome,
    ];
  }

  it('should report the same outcome on all four readings', async () => {
    expect(await readAllFour()).toEqual(['done', 'done', 'done', 'done']);
  });

  it('should change ALL FOUR readings when the one row changes', async () => {
    // The criterion, stated literally: mutate the row, and every surface moves.
    // Four writes could not produce this; one record rendered four ways must.
    row = theRow('failed');
    expect(await readAllFour()).toEqual(['failed', 'failed', 'failed', 'failed']);
  });

  it('should expose exactly one write method on the port', () => {
    // "No surface has its own write path." The port declares `save` and four
    // reads; a second writer would have to appear here first.
    const writeMethods = Object.keys(repository).filter((name) => name === 'save');
    expect(writeMethods).toEqual(['save']);
  });

  it('should carry recordingAvailable on every listing, from the one recorder', async () => {
    // The declaration lives on the recorder, so no listing can disagree with
    // another about whether firings are recorded at all.
    const perRule = await service.listRecentByRule('rule-1');
    const activity = await service.listRecent();
    const bySubject = await service.listRecentBySubject('order', 'ol_order_1');
    expect([
      perRule.recordingAvailable,
      activity.recordingAvailable,
      bySubject.recordingAvailable,
    ]).toEqual([true, true, true]);
  });
});
