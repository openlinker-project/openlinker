/**
 * `describeTaskAcceptance` / `taskStatusText` tests (#3763).
 *
 * Pins the rule that replaced the "Handshake" field: acceptance is news only
 * when it did not happen, only a task with an executor can be waiting for one,
 * a task becomes "stuck" at exactly 15 minutes, and a state this build does
 * not know renders nothing rather than a raw enum.
 */
import { describe, expect, it } from 'vitest';

import {
  describeTaskAcceptance,
  needsAttention,
  TASK_ACCEPTANCE_STUCK_AFTER_MS,
  taskStatusText,
} from './fulfillment-task-acceptance';

const CREATED = '2026-10-16T10:00:00.000Z';
const createdMs = new Date(CREATED).getTime();
const at = (offsetMs: number): Date => new Date(createdMs + offsetMs);
const describeAt = (
  requestStatus: string,
  offsetMs: number,
  assigned = true,
): ReturnType<typeof describeTaskAcceptance> =>
  describeTaskAcceptance({ requestStatus, createdAt: CREATED, assigned }, at(offsetMs));

describe('describeTaskAcceptance (#3763)', () => {
  it('should say nothing when the task is accepted, however old it is', () => {
    expect(describeAt('accepted', 10 * TASK_ACCEPTANCE_STUCK_AFTER_MS)).toEqual({ kind: 'none' });
  });

  it.each(['unsubmitted', 'submitted'])(
    'should read %s as pending just under the threshold',
    (requestStatus) => {
      expect(describeAt(requestStatus, TASK_ACCEPTANCE_STUCK_AFTER_MS - 1)).toEqual({
        kind: 'pending',
      });
    },
  );

  it.each(['unsubmitted', 'submitted'])(
    'should read %s as stuck exactly at the threshold',
    (requestStatus) => {
      expect(describeAt(requestStatus, TASK_ACCEPTANCE_STUCK_AFTER_MS)).toEqual({
        kind: 'stuck',
        waitedMs: TASK_ACCEPTANCE_STUCK_AFTER_MS,
      });
    },
  );

  it('should read a task that was not accepted as refused', () => {
    expect(describeAt('rejected', 0)).toEqual({ kind: 'refused' });
  });

  it('should say nothing about acceptance for a task routed to no executor', () => {
    expect(describeAt('unsubmitted', 10 * TASK_ACCEPTANCE_STUCK_AFTER_MS, false)).toEqual({
      kind: 'none',
    });
    expect(describeAt('rejected', 0, false)).toEqual({ kind: 'none' });
  });

  it('should carry the cancellation wording while a cancellation is negotiated', () => {
    expect(describeAt('cancellation_requested', 0)).toEqual({
      kind: 'cancellation',
      label: 'cancellation requested',
    });
  });

  it('should say nothing for a state this build does not recognise', () => {
    expect(describeAt('some_future_state', 0)).toEqual({ kind: 'none' });
  });

  it('should never call a task stuck when its creation time cannot be read', () => {
    expect(
      describeTaskAcceptance(
        { requestStatus: 'unsubmitted', createdAt: 'not-a-date', assigned: true },
        at(0),
      ),
    ).toEqual({ kind: 'pending' });
  });

  it('should flag only stuck and refused tasks for attention', () => {
    expect(needsAttention({ kind: 'stuck', waitedMs: 1 })).toBe(true);
    expect(needsAttention({ kind: 'refused' })).toBe(true);
    expect(needsAttention({ kind: 'pending' })).toBe(false);
    expect(needsAttention({ kind: 'none' })).toBe(false);
  });
});

describe('taskStatusText (#3763)', () => {
  const where = 'the pack bench';

  it('should be the bare status when acceptance is not news', () => {
    expect(taskStatusText('Open', 'open', { kind: 'none' }, where, true)).toBe('Open');
    expect(taskStatusText('Open', 'open', { kind: 'pending' }, where, true)).toBe('Open');
  });

  it('should join the reason to the status in the badge when packers cannot see the task', () => {
    expect(taskStatusText('Open', 'open', { kind: 'refused' }, where, true)).toBe(
      'Open · Not on the pack bench',
    );
  });

  it('should leave the reason out of the headline, which a sentence explains instead', () => {
    expect(taskStatusText('Open', 'open', { kind: 'stuck', waitedMs: 1 }, where, false)).toBe(
      'Open',
    );
  });

  it('should take the destination as a parameter, so another executor can name itself', () => {
    expect(taskStatusText('Open', 'open', { kind: 'refused' }, 'Acme Fulfilment', true)).toBe(
      'Open · Not on Acme Fulfilment',
    );
  });

  it('should append the cancellation wording, except where the status already says it', () => {
    expect(
      taskStatusText(
        'Open',
        'open',
        { kind: 'cancellation', label: 'cancellation refused' },
        where,
        true,
      ),
    ).toBe('Open · cancellation refused');
    expect(
      taskStatusText(
        'Cancelled',
        'cancelled',
        { kind: 'cancellation', label: 'cancellation accepted' },
        where,
        true,
      ),
    ).toBe('Cancelled');
  });
});
