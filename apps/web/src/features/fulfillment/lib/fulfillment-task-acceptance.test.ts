/**
 * `describeTaskAcceptance` / `taskStateLine` tests (#3763).
 *
 * Pins the rule that replaced the "Handshake" field: acceptance is news only
 * when it did not happen, a task becomes "stuck" at exactly 15 minutes, and a
 * state this build does not know renders nothing rather than a raw enum.
 */
import { describe, expect, it } from 'vitest';

import {
  describeTaskAcceptance,
  TASK_ACCEPTANCE_STUCK_AFTER_MS,
  taskStateLine,
} from './fulfillment-task-acceptance';

const CREATED = '2026-10-16T10:00:00.000Z';
const createdMs = new Date(CREATED).getTime();
const at = (offsetMs: number): Date => new Date(createdMs + offsetMs);
const describeAt = (
  requestStatus: string,
  offsetMs: number,
): ReturnType<typeof describeTaskAcceptance> =>
  describeTaskAcceptance({ requestStatus, createdAt: CREATED }, at(offsetMs));

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

  it('should read a refused task as refused', () => {
    expect(describeAt('rejected', 0)).toEqual({ kind: 'refused' });
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
      describeTaskAcceptance({ requestStatus: 'unsubmitted', createdAt: 'not-a-date' }, at(0)),
    ).toEqual({ kind: 'pending' });
  });
});

describe('taskStateLine (#3763)', () => {
  const where = 'the pack bench';

  it('should be the bare state label when acceptance is not news', () => {
    expect(taskStateLine('Open', { kind: 'none' }, where)).toBe('Open');
    expect(taskStateLine('Open', { kind: 'refused' }, where)).toBe('Open');
  });

  it('should qualify a pending or stuck task with where it is not yet', () => {
    expect(taskStateLine('Open', { kind: 'pending' }, where)).toBe(
      'Open · not on the pack bench yet',
    );
    expect(taskStateLine('Open', { kind: 'stuck', waitedMs: 1 }, where)).toBe(
      'Open · not on the pack bench yet',
    );
  });

  it('should take the destination as a parameter, so another executor can name itself', () => {
    expect(taskStateLine('Open', { kind: 'pending' }, 'Acme Fulfilment')).toBe(
      'Open · not on Acme Fulfilment yet',
    );
  });

  it('should append the cancellation wording', () => {
    expect(
      taskStateLine('Open', { kind: 'cancellation', label: 'cancellation refused' }, where),
    ).toBe('Open · cancellation refused');
  });
});
