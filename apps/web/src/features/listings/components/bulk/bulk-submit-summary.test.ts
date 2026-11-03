/**
 * Bulk submit outcome summary tests (#1933, #3492)
 *
 * Pins the success-toast sentence: the queued count subtracts EVERY backend
 * skip reason, and each non-zero reason is named, so a per-variant exclusion
 * can never shrink the batch silently.
 */
import { describe, expect, it } from 'vitest';
import { describeBulkSubmitOutcome, type BulkSubmitSkipCounts } from './bulk-submit-summary';

const none: BulkSubmitSkipCounts = {
  skippedAlreadyListedCount: 0,
  skippedInvalidEanCount: 0,
  skippedAvailabilityUnknownCount: 0,
};

describe('describeBulkSubmitOutcome', () => {
  it('should report only the queued count when nothing was skipped', () => {
    expect(describeBulkSubmitOutcome(5, none)).toBe('5 offers queued for creation.');
  });

  it('should subtract and name already-listed skips when only those occurred', () => {
    expect(describeBulkSubmitOutcome(5, { ...none, skippedAlreadyListedCount: 2 })).toBe(
      '3 offers queued for creation. Skipped: 2 already listed.'
    );
  });

  it('should subtract and name invalid-EAN skips when only those occurred', () => {
    expect(describeBulkSubmitOutcome(5, { ...none, skippedInvalidEanCount: 1 })).toBe(
      '4 offers queued for creation. Skipped: 1 with an invalid EAN checksum.'
    );
  });

  it('should subtract and name availability-unknown skips when only those occurred', () => {
    expect(describeBulkSubmitOutcome(5, { ...none, skippedAvailabilityUnknownCount: 1 })).toBe(
      '4 offers queued for creation. Skipped: 1 with unknown availability (re-submit to retry).'
    );
  });

  it('should subtract every reason and name each one when all three occurred', () => {
    expect(
      describeBulkSubmitOutcome(10, {
        skippedAlreadyListedCount: 2,
        skippedInvalidEanCount: 3,
        skippedAvailabilityUnknownCount: 1,
      })
    ).toBe(
      '4 offers queued for creation. Skipped: 2 already listed, 3 with an invalid EAN checksum, ' +
        '1 with unknown availability (re-submit to retry).'
    );
  });

  it('should omit zero reasons when only some of them occurred', () => {
    const description = describeBulkSubmitOutcome(6, {
      ...none,
      skippedAlreadyListedCount: 1,
      skippedInvalidEanCount: 2,
    });
    expect(description).toBe(
      '3 offers queued for creation. Skipped: 1 already listed, 2 with an invalid EAN checksum.'
    );
    expect(description).not.toContain('unknown availability');
  });

  it('should never report a negative queued count when the skips exceed the selection', () => {
    expect(describeBulkSubmitOutcome(1, { ...none, skippedInvalidEanCount: 2 })).toBe(
      '0 offers queued for creation. Skipped: 2 with an invalid EAN checksum.'
    );
  });
});
