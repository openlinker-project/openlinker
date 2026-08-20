import { describe, expect, it } from 'vitest';
import { FISCAL_POLL_MS, fiscalPollInterval } from './fiscal-poll-interval';
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
