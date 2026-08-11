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
  OfferLifecycleValues,
  deriveOfferLifecycle,
  readValidationMessages,
} from './offer-lifecycle.types';
import { OfferPublicationStatusValues } from './offer-status-read.types';
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
});
