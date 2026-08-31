import { describe, expect, it } from 'vitest';
import {
  FISCAL_POLL_MS,
  fiscalPollInterval,
  fiscalProgressPollInterval,
} from './fiscal-poll-interval';
import type { FiscalRegistrationStatus } from '../api/fiscalization.types';

describe('fiscalPollInterval', () => {
  it('should poll when the newest record is registering', () => {
    expect(fiscalPollInterval('registering')).toBe(FISCAL_POLL_MS);
  });

  it('should not poll a pending record, which was never sent to the provider', () => {
    // A `pending` row holds no lease: nothing is in flight for a refetch to
    // observe, so polling it every 5 s forever would describe a non-event.
    expect(fiscalPollInterval('pending')).toBe(false);
  });

  it.each<FiscalRegistrationStatus>(['registered', 'failed'])(
    'should not poll a terminal %s record',
    (status) => {
      expect(fiscalPollInterval(status)).toBe(false);
    }
  );

  it('should not poll when the order holds no record at all', () => {
    expect(fiscalPollInterval(undefined)).toBe(false);
  });
});

describe('fiscalProgressPollInterval', () => {
  it('should poll while work is outstanding', () => {
    expect(fiscalProgressPollInterval('queued')).toBe(FISCAL_POLL_MS);
    expect(fiscalProgressPollInterval('running')).toBe(FISCAL_POLL_MS);
  });

  it('should not poll a stalled registration, because nothing is running', () => {
    // Refetching would describe something that is not happening. Only asking
    // again moves it.
    expect(fiscalProgressPollInterval('stalled')).toBe(false);
  });

  it('should not poll a settled outcome or an unasked sale', () => {
    expect(fiscalProgressPollInterval('registered')).toBe(false);
    expect(fiscalProgressPollInterval('rejected')).toBe(false);
    expect(fiscalProgressPollInterval('in-doubt')).toBe(false);
    expect(fiscalProgressPollInterval('not-requested')).toBe(false);
    expect(fiscalProgressPollInterval(undefined)).toBe(false);
  });
});
