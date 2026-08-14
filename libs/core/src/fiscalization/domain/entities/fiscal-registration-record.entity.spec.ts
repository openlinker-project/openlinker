/**
 * Fiscal Registration Record - unit tests
 *
 * The derivations here decide whether OL is allowed to cross the provider
 * boundary again for a sale that may already be registered, so each is pinned
 * explicitly - including the mode-less `failed` row, which is the shape a legacy
 * or partially-written record takes and must fall on the SAFE side.
 *
 * @module libs/core/src/fiscalization/domain/entities
 */
import { FiscalRegistrationRecord } from './fiscal-registration-record.entity';
import type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
} from '../types/fiscalization.types';

function record(
  status: FiscalRegistrationStatus,
  overrides: {
    failureMode?: FiscalRegistrationFailureMode | null;
    leaseExpiresAt?: Date | null;
  } = {},
): FiscalRegistrationRecord {
  const now = new Date('2026-08-14T10:00:00.000Z');
  return new FiscalRegistrationRecord(
    'rec-1',
    'conn-1',
    'ol_order_1',
    'provider-a',
    'fiscal:conn-1:ol_order_1',
    status,
    null,
    null,
    null,
    null,
    null,
    null,
    overrides.failureMode ?? null,
    null,
    null,
    overrides.leaseExpiresAt ?? null,
    now,
    now,
  );
}

describe('FiscalRegistrationRecord', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');

  describe('isRegistered', () => {
    it('should be true only for a registered record', () => {
      expect(record('registered').isRegistered).toBe(true);
      expect(record('pending').isRegistered).toBe(false);
      expect(record('registering').isRegistered).toBe(false);
      expect(record('failed').isRegistered).toBe(false);
    });
  });

  describe('isLeaseLive', () => {
    it('should be true when a registering row holds a lease in the future', () => {
      const future = new Date(now.getTime() + 60_000);
      expect(record('registering', { leaseExpiresAt: future }).isLeaseLive(now)).toBe(true);
    });

    it('should be false when the lease has expired (a crashed prior attempt)', () => {
      const past = new Date(now.getTime() - 60_000);
      expect(record('registering', { leaseExpiresAt: past }).isLeaseLive(now)).toBe(false);
    });

    it('should be false for a registering row with no lease at all', () => {
      expect(record('registering', { leaseExpiresAt: null }).isLeaseLive(now)).toBe(false);
    });

    it('should be false for any non-registering status even with a live lease', () => {
      const future = new Date(now.getTime() + 60_000);
      expect(record('pending', { leaseExpiresAt: future }).isLeaseLive(now)).toBe(false);
      expect(record('registered', { leaseExpiresAt: future }).isLeaseLive(now)).toBe(false);
    });
  });

  describe('isReattemptableFailure', () => {
    it('should be true ONLY for a terminal rejected failure', () => {
      expect(record('failed', { failureMode: 'rejected' }).isReattemptableFailure).toBe(true);
    });

    it('should be false for an in-doubt failure - the sale may already be registered', () => {
      expect(record('failed', { failureMode: 'in-doubt' }).isReattemptableFailure).toBe(false);
    });

    it('should be false for a failed row with no mode (the fiscal-safe default)', () => {
      // An unreadable mode is indistinguishable from in-doubt, and guessing the
      // other way would license a resend of a sale that may already be registered.
      expect(record('failed', { failureMode: null }).isReattemptableFailure).toBe(false);
    });

    it('should be false for a non-failed status', () => {
      expect(record('pending').isReattemptableFailure).toBe(false);
      expect(record('registered').isReattemptableFailure).toBe(false);
    });
  });

  describe('isInDoubt', () => {
    it('should identify only the state a provider lookup or an operator can settle', () => {
      expect(record('failed', { failureMode: 'in-doubt' }).isInDoubt).toBe(true);
      expect(record('failed', { failureMode: 'rejected' }).isInDoubt).toBe(false);
      expect(record('failed', { failureMode: null }).isInDoubt).toBe(false);
      expect(record('registering').isInDoubt).toBe(false);
    });
  });

  describe('blocksFurtherRegistration', () => {
    it('should block a SECOND originating registration for every live state', () => {
      expect(record('pending').blocksFurtherRegistration).toBe(true);
      expect(record('registering').blocksFurtherRegistration).toBe(true);
      expect(record('registered').blocksFurtherRegistration).toBe(true);
    });

    it('should NOT block after a terminal rejection - the provider created nothing', () => {
      expect(record('failed', { failureMode: 'rejected' }).blocksFurtherRegistration).toBe(
        false,
      );
    });

    it('should block an in-doubt failure - the sale may already be registered', () => {
      expect(record('failed', { failureMode: 'in-doubt' }).blocksFurtherRegistration).toBe(
        true,
      );
    });

    it('should block a failed row with no mode (the fiscal-safe default)', () => {
      expect(record('failed', { failureMode: null }).blocksFurtherRegistration).toBe(true);
    });

    it('should block a registering row whose lease already expired', () => {
      // Lease-INDEPENDENT on purpose: an expired lease means the prior attempt
      // crashed mid-flight, not that it created nothing. Re-claiming it under the
      // SAME key is safe; starting a NEW registration is not.
      expect(
        record('registering', { leaseExpiresAt: new Date('2020-01-01T00:00:00.000Z') })
          .blocksFurtherRegistration,
      ).toBe(true);
    });

    it('should agree with ADR-041 §3b: only a terminal rejection frees the order', () => {
      // One assertion over the whole status space, so a new status value cannot
      // be added on the permissive side by accident.
      const blocking = [
        record('pending'),
        record('registering'),
        record('registered'),
        record('failed', { failureMode: 'in-doubt' }),
        record('failed', { failureMode: null }),
      ];
      expect(blocking.every((r) => r.blocksFurtherRegistration)).toBe(true);
      expect(record('failed', { failureMode: 'rejected' }).blocksFurtherRegistration).toBe(
        false,
      );
    });
  });
});
