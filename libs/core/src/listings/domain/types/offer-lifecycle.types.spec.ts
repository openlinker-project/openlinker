/**
 * Offer Lifecycle — Unit Tests
 *
 * Pins the five-bucket partition the redesigned listings page depends on
 * (#2025), including the `inactive` split that is the whole reason the
 * derivation cannot be sourced from `OfferCreationRecord.status`.
 *
 * @module libs/core/src/listings/domain/types
 */
import {
  OFFER_VALIDATION_MESSAGES_KEY,
  OfferLifecycleValues,
  deriveOfferLifecycle,
  emptyOfferLifecycleCounts,
  listSnapshotFactsForLifecycle,
  readValidationMessages,
  resolveOfferLifecycle,
  sumOfferLifecycleCounts,
} from './offer-lifecycle.types';
import {
  OfferPublicationStatusValues,
  isOfferPublicationStatus,
} from './offer-status-read.types';
import type { OfferStatusSnapshotDetails } from './offer-status-snapshot.types';

describe('deriveOfferLifecycle', () => {
  it('should return Active when the offer is live', () => {
    expect(deriveOfferLifecycle('active', null)).toBe('Active');
  });

  it.each(['activating', 'inactivating'] as const)(
    'should fold the transient %s status into Active',
    (status) => {
      expect(deriveOfferLifecycle(status, null)).toBe('Active');
    }
  );

  it('should return Ended when the offer is over on the marketplace', () => {
    expect(deriveOfferLifecycle('ended', null)).toBe('Ended');
  });

  it('should return Inactive when an inactive offer carries validator messages', () => {
    const details: OfferStatusSnapshotDetails = {
      validationMessages: ['Brak parametru: Marka'],
    };

    expect(deriveOfferLifecycle('inactive', details)).toBe('Inactive');
  });

  it('should return Draft when an inactive offer carries no statusDetails at all', () => {
    expect(deriveOfferLifecycle('inactive', null)).toBe('Draft');
  });

  it('should return Draft when an inactive offer carries an empty validator message list', () => {
    expect(deriveOfferLifecycle('inactive', { validationMessages: [] })).toBe('Draft');
  });

  it('should return Draft when an inactive offer carries statusDetails without the messages key', () => {
    expect(deriveOfferLifecycle('inactive', {})).toBe('Draft');
  });

  it('should keep Draft and Ended disjoint even though the creation poller conflates them', () => {
    // The trap #2025 exists to avoid: OfferCreationRecord.status maps BOTH a
    // clean `inactive` and `ended` to Draft, which would swallow ended offers.
    expect(deriveOfferLifecycle('inactive', null)).not.toBe(deriveOfferLifecycle('ended', null));
  });

  it('should map every publication status to its exact bucket', () => {
    const buckets = OfferPublicationStatusValues.map((status) => [
      status,
      deriveOfferLifecycle(status, null),
    ]);

    expect(buckets).toEqual([
      ['active', 'Active'],
      ['activating', 'Active'],
      ['inactivating', 'Active'],
      ['inactive', 'Draft'],
      ['ended', 'Ended'],
    ]);
  });

  it('should never return Unsynced - absence of a snapshot is classified by the caller', () => {
    const buckets = OfferPublicationStatusValues.flatMap((status) => [
      deriveOfferLifecycle(status, null),
      deriveOfferLifecycle(status, { validationMessages: ['x'] }),
    ]);

    expect(buckets).not.toContain('Unsynced');
  });
});

describe('OfferLifecycleValues', () => {
  it('should carry the Unsynced bucket so every mapped offer has a home (#2025)', () => {
    expect(OfferLifecycleValues).toEqual(['Active', 'Inactive', 'Draft', 'Ended', 'Unsynced']);
  });
});

describe('readValidationMessages', () => {
  it('should return an empty list when no details were observed', () => {
    expect(readValidationMessages(null)).toEqual([]);
  });

  it('should return the observed messages verbatim', () => {
    expect(readValidationMessages({ validationMessages: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('should read the same key SQL groups by, so the two cannot drift (#2026)', () => {
    expect(OFFER_VALIDATION_MESSAGES_KEY).toBe('validationMessages');
    expect(readValidationMessages({ [OFFER_VALIDATION_MESSAGES_KEY]: ['a'] })).toEqual(['a']);
  });
});

describe('isOfferPublicationStatus (#2026)', () => {
  it.each(OfferPublicationStatusValues)('should accept the union member %s', (status) => {
    expect(isOfferPublicationStatus(status)).toBe(true);
  });

  it.each(['suspended', 'ACTIVE', '', 'draft'])(
    'should reject %p, which the unconstrained text column can still hold',
    (value) => {
      expect(isOfferPublicationStatus(value)).toBe(false);
    }
  );
});

describe('resolveOfferLifecycle (#2026)', () => {
  it('should return Unsynced when the status-snapshot join found no row', () => {
    expect(resolveOfferLifecycle(null)).toBe('Unsynced');
  });

  it('should agree with deriveOfferLifecycle for every snapshot fact combination', () => {
    // The one rule both the per-row list projection and the grouped tab-count
    // aggregate go through - if these ever disagree, so do the tabs and rows.
    for (const publicationStatus of OfferPublicationStatusValues) {
      for (const hasValidationMessages of [true, false]) {
        const details: OfferStatusSnapshotDetails | null = hasValidationMessages
          ? { validationMessages: ['Brak parametru: Marka'] }
          : null;

        expect(resolveOfferLifecycle({ publicationStatus, hasValidationMessages })).toBe(
          deriveOfferLifecycle(publicationStatus, details)
        );
      }
    }
  });
});

describe('listSnapshotFactsForLifecycle (#2026)', () => {
  it('should assign every snapshot fact combination to exactly one bucket', () => {
    const assignments = OfferLifecycleValues.flatMap((lifecycle) =>
      listSnapshotFactsForLifecycle(lifecycle).map(
        (facts) => `${facts.publicationStatus}:${String(facts.hasValidationMessages)}`
      )
    );

    // 5 publication statuses x the one boolean, each claimed once - the
    // partition property the tab counts rely on to sum to the total.
    expect(assignments).toHaveLength(OfferPublicationStatusValues.length * 2);
    expect(new Set(assignments).size).toBe(assignments.length);
  });

  it('should return no facts for Unsynced, which is the absence of a snapshot', () => {
    expect(listSnapshotFactsForLifecycle('Unsynced')).toEqual([]);
  });

  it('should split the inactive status across Inactive and Draft by message presence', () => {
    expect(listSnapshotFactsForLifecycle('Inactive')).toEqual([
      { publicationStatus: 'inactive', hasValidationMessages: true },
    ]);
    expect(listSnapshotFactsForLifecycle('Draft')).toEqual([
      { publicationStatus: 'inactive', hasValidationMessages: false },
    ]);
  });

  it('should claim a status under both message-presence values when it does not depend on them', () => {
    expect(listSnapshotFactsForLifecycle('Ended')).toEqual([
      { publicationStatus: 'ended', hasValidationMessages: true },
      { publicationStatus: 'ended', hasValidationMessages: false },
    ]);
  });
});

describe('offer lifecycle counts (#2026)', () => {
  it('should zero every bucket so an empty one is reported rather than absent', () => {
    expect(emptyOfferLifecycleCounts()).toEqual({
      Active: 0,
      Inactive: 0,
      Draft: 0,
      Ended: 0,
      Unsynced: 0,
    });
    expect(Object.keys(emptyOfferLifecycleCounts()).sort()).toEqual([...OfferLifecycleValues].sort());
  });

  it('should sum every bucket, including Unsynced', () => {
    expect(
      sumOfferLifecycleCounts({ Active: 3, Inactive: 1, Draft: 2, Ended: 4, Unsynced: 90 })
    ).toBe(100);
  });

  it('should sum a zeroed count to zero', () => {
    expect(sumOfferLifecycleCounts(emptyOfferLifecycleCounts())).toBe(0);
  });
});
