/**
 * Hold vocabulary + copy unit tests (#2342).
 *
 * The mirror's ORDER is guarded by `scripts/check-hold-reason-mirror.mjs`; what
 * is asserted here is what the script deliberately does not read — that every
 * reason is renderable, that an unknown value is refused rather than defaulted,
 * and that a `failed` provisioning resume can never be reported as a success.
 */
import { describe, expect, it } from 'vitest';

import {
  describeProvisioningResume,
  HOLD_REASON_COPY,
  HoldReasonValues,
  holdReasonLabel,
  isHoldReason,
} from './order-hold.types';

describe('hold reason vocabulary (#2342)', () => {
  it('should carry renderable copy for every reason', () => {
    for (const reason of HoldReasonValues) {
      const copy = HOLD_REASON_COPY[reason];
      expect(copy.label.length).toBeGreaterThan(0);
      // The style guide budgets ~17 characters for a status pill.
      expect(copy.label.length).toBeLessThanOrEqual(17);
      expect(copy.hint.length).toBeGreaterThan(0);
    }
  });

  it('should accept every declared reason and reject anything else', () => {
    for (const reason of HoldReasonValues) {
      expect(isHoldReason(reason)).toBe(true);
    }
    // No default: an unrecognised reason must never silently become `operator`,
    // which would attribute a machine's hold to a human.
    expect(isHoldReason('not-a-reason')).toBe(false);
    expect(isHoldReason(null)).toBe(false);
    expect(isHoldReason(undefined)).toBe(false);
    expect(isHoldReason(7)).toBe(false);
  });

  it('should fall back to the raw value when a reason is unrecognised', () => {
    expect(holdReasonLabel('operator')).toBe('Held by operator');
    // Surfaced rather than dropped — a hold the operator cannot see is worse
    // than one labelled awkwardly.
    expect(holdReasonLabel('reason-from-a-newer-build')).toBe('reason-from-a-newer-build');
  });
});

describe('describeProvisioningResume (#2342)', () => {
  it('should report an enqueued resume as a success', () => {
    const copy = describeProvisioningResume({ status: 'enqueued', jobId: 'job_1', reason: null });
    expect(copy.tone).toBe('success');
    expect(copy.message).toContain('Hold released');
  });

  it('should report a skipped resume as healthy, naming why nothing restarted', () => {
    const copy = describeProvisioningResume({
      status: 'skipped',
      jobId: null,
      reason: 'missing-source-external-id',
    });
    // A skipped order has no source-side job to run at all — reporting that as
    // a failure would put a red state on a healthy order.
    expect(copy.tone).toBe('success');
    expect(copy.message).toContain('channel reference');
  });

  it('should NEVER report a failed resume as a success, and should name the remedy', () => {
    const copy = describeProvisioningResume({
      status: 'failed',
      jobId: null,
      reason: 'enqueue-failed',
    });
    expect(copy.tone).toBe('warning');
    expect(copy.message).toContain('did not restart');
    // The operator's actual next step is the existing destination Retry action.
    expect(copy.message).toContain('Retry');
  });

  it('should report the release only when the API sent no resume at all', () => {
    // An API predating #2341. Never invent `enqueued`.
    const copy = describeProvisioningResume(undefined);
    expect(copy.tone).toBe('success');
    expect(copy.message).toBe('Hold released.');
  });
});
