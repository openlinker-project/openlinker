import { describe, it, expect } from 'vitest';
import type { OfferMapping, OfferMappingIdentity } from '../api/listings.types';
import { isOverselling, listingRowAlert, listingRowBadges } from './listing-row-state';

const IDENTITY: OfferMappingIdentity = {
  productId: 'ol_product_1',
  productName: 'Doniczka ceramiczna Terra',
  variantLabel: 'Terakota 24 cm',
  sku: 'TERRA-24-TER',
  ean: '5900000000138',
  imageUrl: null,
  isStale: false,
};
const STALE_IDENTITY: OfferMappingIdentity = { ...IDENTITY, isStale: true };

function makeRow(overrides: Partial<OfferMapping> = {}): OfferMapping {
  return {
    id: 'uuid-1',
    entityType: 'Offer',
    internalId: 'ol_variant_abc',
    externalId: '14829301',
    platformType: 'erli',
    connectionId: 'conn-1',
    context: null,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    identity: IDENTITY,
    channelStatus: {
      publicationStatus: 'active',
      lifecycle: 'Active',
      validationMessages: [],
      lastStatusSyncedAt: '2026-07-21T02:10:00.000Z',
    },
    commercial: {
      price: 100,
      currency: 'PLN',
      availableQuantity: 41,
      lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
    },
    ...overrides,
  };
}

describe('listingRowBadges', () => {
  it('should badge nothing when the offer is plainly active', () => {
    expect(listingRowBadges(makeRow())).toEqual([]);
  });

  it('should badge a mid-transition offer with a pulsing info badge', () => {
    const badges = listingRowBadges(
      makeRow({
        channelStatus: {
          publicationStatus: 'activating',
          lifecycle: 'Active',
          validationMessages: [],
          lastStatusSyncedAt: '2026-07-21T02:12:00.000Z',
        },
      }),
    );

    expect(badges).toHaveLength(1);
    expect(badges[0]).toMatchObject({ label: 'Activating', tone: 'info', pulse: true });
  });

  it('should badge a validator-refused offer as Rejected', () => {
    const badges = listingRowBadges(
      makeRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Inactive',
          validationMessages: ['Brak wymaganego parametru: Materiał'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(badges.map((b) => b.label)).toEqual(['Rejected']);
  });

  it('should badge an unsynced row without promising it will sync', () => {
    const badges = listingRowBadges(
      makeRow({
        channelStatus: {
          publicationStatus: null,
          lifecycle: 'Unsynced',
          validationMessages: [],
          lastStatusSyncedAt: null,
        },
      }),
    );

    expect(badges[0]?.label).toBe('Not synced');
    expect(badges[0]?.title).toBe('No channel status has ever been read for this offer.');
    expect(badges[0]?.title).not.toMatch(/soon|shortly|will sync/i);
  });

  it('should badge a stale variant even when the channel reports no stock', () => {
    const badges = listingRowBadges(
      makeRow({
        identity: STALE_IDENTITY,
        commercial: {
          price: 100,
          currency: 'PLN',
          availableQuantity: 0,
          lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
        },
      }),
    );

    expect(badges[0]).toMatchObject({ label: 'Product deleted', tone: 'error', solid: false });
  });

  it('should escalate a stale variant that still has channel stock to a solid badge', () => {
    const badges = listingRowBadges(makeRow({ identity: STALE_IDENTITY }));

    expect(badges[0]).toMatchObject({
      label: 'Selling deleted product',
      tone: 'error',
      solid: true,
    });
  });

  it('should keep both the stale badge and the lifecycle badge when a row earns each', () => {
    const badges = listingRowBadges(
      makeRow({
        identity: STALE_IDENTITY,
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Inactive',
          validationMessages: ['Zdjęcie główne poniżej wymaganej rozdzielczości'],
          lastStatusSyncedAt: '2026-07-20T22:40:00.000Z',
        },
      }),
    );

    expect(badges.map((b) => b.label)).toEqual(['Selling deleted product', 'Rejected']);
  });
});

describe('isOverselling', () => {
  it('should be false when the quantity is not reported, never treating null as stock', () => {
    expect(
      isOverselling(
        makeRow({
          identity: STALE_IDENTITY,
          commercial: {
            price: 100,
            currency: 'PLN',
            availableQuantity: null,
            lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
          },
        }),
      ),
    ).toBe(false);
  });

  it('should be false for a live variant with stock', () => {
    expect(isOverselling(makeRow())).toBe(false);
  });
});

describe('listingRowAlert', () => {
  it('should return no alert for a healthy row', () => {
    expect(listingRowAlert(makeRow())).toBeNull();
  });

  it('should surface the first validator message verbatim', () => {
    const alert = listingRowAlert(
      makeRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Inactive',
          validationMessages: ['Brak wymaganego parametru: Materiał', 'second'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(alert?.text).toBe('Brak wymaganego parametru: Materiał');
  });

  it('should outrank a validator message with the overselling warning', () => {
    const alert = listingRowAlert(
      makeRow({
        identity: STALE_IDENTITY,
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Inactive',
          validationMessages: ['Brak wymaganego parametru: Materiał'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(alert?.text).toBe('Still 41 available on channel - the master product no longer exists');
  });
});
