/**
 * Connection Backlog Domain Service Unit Tests
 *
 * Covers the derived threshold, the three-condition alert rule (including the
 * fresh-sweep false alarm it exists to prevent), and the NULL exclusion in the
 * attempt-duration mean.
 *
 * @module libs/core/src/sync/domain/domain-services
 */
import {
  averageAttemptDuration,
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

  describe('averageAttemptDuration', () => {
    it('should divide by the non-null sample size, not the job count', () => {
      // Three jobs finished, only two recorded a duration. Dividing the same
      // total by three would understate the real mean.
      expect(averageAttemptDuration(600, 2)).toBe(300);
    });

    it('should report null when no row carried a duration, never zero', () => {
      expect(averageAttemptDuration(0, 0)).toBeNull();
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
          arrivalRatePerHour: 60,
          drainRatePerHour: 60,
          alertThresholdJobs: 1440,
        })
      ).toBe('growing');
    });

    it('should alert when nothing drains at all and the queue has waited past the horizon', () => {
      // A zero drain rate is evidence, not missing data.
      expect(
        classifyConnectionBacklog({
          ...base,
          queuedCount: 12,
          arrivalRatePerHour: 0,
          drainRatePerHour: 0,
          alertThresholdJobs: 0,
        })
      ).toBe('backlogged');
    });
  });

  describe('deriveBacklogSignal', () => {
    const stats: ConnectionBacklogStats = {
      queuedCount: 15066,
      runningCount: 2,
      deadCount: 4,
      arrivedInWindow: 200,
      completedInWindow: 55,
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
