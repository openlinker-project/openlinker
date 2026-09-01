/**
 * Fiscal Registration Progress rule (#2526)
 *
 * Pins the two properties the rule exists for: the window with a job and no
 * record is reportable, and a settled record outranks a job row that has not
 * caught up.
 *
 * @module libs/core/src/fiscalization/domain/types
 */
import {
  FiscalRegistrationProgressValues,
  resolveFiscalRegistrationProgress,
} from './fiscal-registration-progress.types';

describe('resolveFiscalRegistrationProgress', () => {
  it('should report a sale nobody asked to register as not requested', () => {
    expect(resolveFiscalRegistrationProgress({ record: null, job: 'none' })).toBe('not-requested');
  });

  it('should report the window between enqueueing and the job running as queued', () => {
    // No record exists yet. Reading the record alone here would report the sale
    // as never requested, moments after the operator asked for it.
    expect(resolveFiscalRegistrationProgress({ record: null, job: 'live' })).toBe('queued');
  });

  it('should report a job that gave up before writing a record as stalled', () => {
    expect(resolveFiscalRegistrationProgress({ record: null, job: 'dead' })).toBe('stalled');
  });

  it('should report a live claim as running', () => {
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'registering', failureMode: null, leaseLive: true },
        job: 'live',
      }),
    ).toBe('running');
  });

  it('should let a settled record outrank a job row that has not caught up', () => {
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'registered', failureMode: null, leaseLive: false },
        job: 'live',
      }),
    ).toBe('registered');
  });

  it('should keep a rejection apart from an in-doubt outcome', () => {
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'failed', failureMode: 'rejected', leaseLive: false },
        job: 'none',
      }),
    ).toBe('rejected');
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'failed', failureMode: 'in-doubt', leaseLive: false },
        job: 'none',
      }),
    ).toBe('in-doubt');
  });

  it('should treat an unreadable failure as in doubt, never as a rejection', () => {
    // Only a terminal rejection means the provider definitely created nothing.
    // An absent mode is not evidence of that.
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'failed', failureMode: null, leaseLive: false },
        job: 'none',
      }),
    ).toBe('in-doubt');
  });

  it('should distinguish an intent that is waiting from one nothing will pick up', () => {
    const pending = { status: 'pending' as const, failureMode: null, leaseLive: false };
    expect(resolveFiscalRegistrationProgress({ record: pending, job: 'live' })).toBe('queued');
    expect(resolveFiscalRegistrationProgress({ record: pending, job: 'dead' })).toBe('stalled');
    expect(resolveFiscalRegistrationProgress({ record: pending, job: 'none' })).toBe('stalled');
  });

  it('should treat an expired claim as not running', () => {
    // An expired lease means the previous attempt died, not that one is running.
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'registering', failureMode: null, leaseLive: false },
        job: 'live',
      }),
    ).toBe('queued');
  });

  it('should not report a crashed attempt as work that never reached the provider', () => {
    // The distinction the two values exist for. A `pending` row was written
    // before any outbound call; a `registering` row whose claim expired is an
    // attempt that may already have crossed the boundary, and nothing may state
    // an absence for it.
    const crashed = { status: 'registering' as const, failureMode: null, leaseLive: false };
    expect(resolveFiscalRegistrationProgress({ record: crashed, job: 'none' })).toBe('interrupted');
    expect(resolveFiscalRegistrationProgress({ record: crashed, job: 'dead' })).toBe('interrupted');
  });

  it('should rank a settled record above a live claim flag', () => {
    // Unreachable in practice, and the ordering still has to match what the
    // docblock says: a record that reached its outcome is never still running.
    expect(
      resolveFiscalRegistrationProgress({
        record: { status: 'registered', failureMode: null, leaseLive: true },
        job: 'live',
      }),
    ).toBe('registered');
  });

  it('should only ever answer with a published value', () => {
    const answers = [
      resolveFiscalRegistrationProgress({ record: null, job: 'none' }),
      resolveFiscalRegistrationProgress({ record: null, job: 'live' }),
      resolveFiscalRegistrationProgress({ record: null, job: 'dead' }),
    ];
    for (const answer of answers) {
      expect(FiscalRegistrationProgressValues).toContain(answer);
    }
  });
});
