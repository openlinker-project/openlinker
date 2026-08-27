/**
 * Connection Backlog Domain Service Unit Tests
 *
 * Covers the derived threshold and the four-condition alert rule, in both
 * directions: the false alarms it exists to prevent (a fresh sweep, one job in
 * retry backoff, steady state) and the genuine backlog it must still catch.
 *
 * @module libs/core/src/sync/domain/domain-services
 */
import {
  classifyConnectionBacklog,
  deriveAlertThresholdJobs,
  deriveBacklogSignal,
  estimateClearanceMs,
  toRatePerHour,
} from './connection-backlog.domain-service';
import type { ConnectionBacklogStats } from '../types/connection-sync-status.types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('connection backlog domain service', () => {
  describe('toRatePerHour', () => {
    it('should convert a count over a window into a per-hour rate', () => {
      expect(toRatePerHour(30, 30 * 60 * 1000)).toBe(60);
    });

    it('should report zero when the window is zero, rather than dividing by zero', () => {
      expect(toRatePerHour(5, 0)).toBe(0);
    });
  });

  describe('deriveAlertThresholdJobs', () => {
    it('should scale the threshold with the measured drain rate, not a fixed number', () => {
      expect(deriveAlertThresholdJobs(20, DAY)).toBe(480);
      expect(deriveAlertThresholdJobs(1500, DAY)).toBe(36000);
    });

    it('should derive a zero threshold when nothing drains', () => {
      expect(deriveAlertThresholdJobs(0, DAY)).toBe(0);
    });
  });

  describe('estimateClearanceMs', () => {
    it('should estimate clearance from the net drain rate', () => {
      expect(estimateClearanceMs(100, 60, 10)).toBe(2 * HOUR);
    });

    it('should report null when the queue is not converging, never a very large number', () => {
      expect(estimateClearanceMs(100, 10, 60)).toBeNull();
      expect(estimateClearanceMs(100, 10, 10)).toBeNull();
    });

    it('should report zero for an empty queue', () => {
      expect(estimateClearanceMs(0, 0, 0)).toBe(0);
    });
  });

  describe('classifyConnectionBacklog', () => {
    const base = {
      queuedCount: 5000,
      arrivalRatePerHour: 200,
      drainRatePerHour: 55,
      alertThresholdJobs: 1320,
      oldestQueuedWaitMs: 3 * DAY,
      alertHorizonMs: DAY,
      succeededInWindow: 55,
      deadInWindow: 0,
    };

    it('should report idle when nothing is queued', () => {
      expect(classifyConnectionBacklog({ ...base, queuedCount: 0 })).toBe('idle');
    });

    it('should report draining when more work finished than arrived', () => {
      expect(
        classifyConnectionBacklog({ ...base, arrivalRatePerHour: 10, drainRatePerHour: 200 })
      ).toBe('draining');
    });

    it('should report backlogged when the queue is not converging, is over the derived threshold and has already waited past the horizon', () => {
      expect(classifyConnectionBacklog(base)).toBe('backlogged');
    });

    it('should not alert on a queue an operator just filled with a full sweep', () => {
      // A sweep enqueues thousands of jobs in one minute: not converging and
      // far over the threshold, yet nothing is wrong. The wait test is what
      // keeps this quiet.
      expect(classifyConnectionBacklog({ ...base, oldestQueuedWaitMs: 4 * 60 * 1000 })).toBe(
        'growing'
      );
    });

    it('should not alert on a small non-converging queue that stays under the derived threshold', () => {
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 40,
          arrivalRatePerHour: 80,
          drainRatePerHour: 60,
          alertThresholdJobs: 1440,
        })
      ).toBe('growing');
    });

    it('should not alert on one long-waiting job while nothing was measured as draining', () => {
      // The false alarm this rule exists to prevent. A failing job is requeued
      // with its original createdAt, so on a quiet connection it looks like a
      // day-old queue. A measured drain rate of 0 makes the derived threshold
      // 0, which without the absolute floor turned "over the threshold" into
      // "not empty".
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 1,
          arrivalRatePerHour: 0,
          drainRatePerHour: 0,
          alertThresholdJobs: 0,
          succeededInWindow: 0,
          deadInWindow: 0,
        })
      ).toBe('growing');
    });

    it('should not alert on a deep queue while nothing succeeded in the window', () => {
      // No rate was measured, so no rate-derived claim can be made. 'failing'
      // or 'growing' is the honest reading, never the red banner.
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 5000,
          arrivalRatePerHour: 0,
          drainRatePerHour: 0,
          alertThresholdJobs: 0,
          succeededInWindow: 0,
          deadInWindow: 0,
        })
      ).toBe('growing');
    });

    it('should still alert on a genuine backlog once a drain rate has been measured', () => {
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 15066,
          arrivalRatePerHour: 200,
          drainRatePerHour: 55,
          alertThresholdJobs: 55 * 24,
          succeededInWindow: 55,
        })
      ).toBe('backlogged');
    });

    it('should treat a steady-state tie as converging rather than falling behind', () => {
      expect(
        classifyConnectionBacklog({ ...base, arrivalRatePerHour: 100, drainRatePerHour: 100 })
      ).toBe('draining');
    });

    it('should not call a stalled queue converging just because nothing arrived either', () => {
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 3,
          arrivalRatePerHour: 0,
          drainRatePerHour: 0,
          alertThresholdJobs: 0,
          succeededInWindow: 0,
        })
      ).toBe('growing');
    });

    it('should report failing when nothing succeeded and jobs died, even with an empty queue', () => {
      // Deaths are not drain. Counting them as drain let a connection whose
      // every job fails fast read green with an empty queue.
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 0,
          drainRatePerHour: 0,
          succeededInWindow: 0,
          deadInWindow: 6,
        })
      ).toBe('failing');
    });
  });

  describe('deriveBacklogSignal', () => {
    const stats: ConnectionBacklogStats = {
      queuedCount: 15066,
      deferredCount: 3,
      runningCount: 2,
      deadCount: 4,
      arrivedInWindow: 200,
      succeededInWindow: 55,
      deadInWindow: 0,
      lastSucceededAt: new Date('2026-08-27T09:30:00.000Z'),
      averageAttemptDurationMs: 4200,
      attemptDurationSampleSize: 55,
      oldestQueuedAt: new Date('2026-08-24T10:00:00.000Z'),
    };
    const now = new Date('2026-08-27T10:00:00.000Z');

    it('should derive rates, threshold and status from the measured counts', () => {
      const signal = deriveBacklogSignal(stats, now, HOUR, DAY);

      expect(signal.arrivalRatePerHour).toBe(200);
      expect(signal.drainRatePerHour).toBe(55);
      expect(signal.alertThresholdJobs).toBe(55 * 24);
      expect(signal.estimatedClearanceMs).toBeNull();
      expect(signal.oldestQueuedWaitMs).toBe(3 * DAY);
      expect(signal.status).toBe('backlogged');
    });

    it('should report a null wait when nothing is queued', () => {
      const signal = deriveBacklogSignal(
        { ...stats, queuedCount: 0, oldestQueuedAt: null },
        now,
        HOUR,
        DAY
      );

      expect(signal.oldestQueuedWaitMs).toBeNull();
      expect(signal.status).toBe('idle');
    });
  });
});
