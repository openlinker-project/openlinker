import { describe, it, expect } from 'vitest';
import type {
  OfferMapping,
  OfferMappingChannelStatus,
  OfferMappingIdentity,
  OfferValidationProblem,
} from '../api/listings.types';
import { isOverselling, isUnlinked, listingRowAlert, listingRowBadges } from './listing-row-state';

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
      price: '100.00',
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

  // NOT "Rejected": the bucket is `inactive` PLUS validator messages, which a
  // seller who deactivated the offer himself also satisfies.
  it('should label a validator-flagged inactive offer as Invalid, not Rejected', () => {
    const badges = listingRowBadges(
      makeRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Invalid',
          validationMessages: ['Brak wymaganego parametru: Materiał'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(badges.map((b) => b.label)).toEqual(['Invalid']);
    expect(badges[0]?.title).toMatch(/validator errors/i);
    expect(badges[0]?.title).not.toMatch(/refused|rejected/i);
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
    // The copy states only what has happened, never what is coming next.
    expect(badges[0]?.title).toBe('No channel status has ever been read for this offer.');
  });

  it('should keep Draft, Ended and Not synced all soft, reserving solid for escalation', () => {
    const soft = (['Draft', 'Ended', 'Unsynced'] as const).map(
      (lifecycle) =>
        listingRowBadges(
          makeRow({
            channelStatus: {
              publicationStatus: null,
              lifecycle,
              validationMessages: [],
              lastStatusSyncedAt: null,
            },
          }),
        )[0],
    );

    expect(soft.map((b) => b?.label)).toEqual(['Draft', 'Ended', 'Not synced']);
    expect(soft.every((b) => b?.tone === 'neutral' && !b?.solid)).toBe(true);
  });

  it('should badge a stale variant as paused when the channel reports no stock', () => {
    const badges = listingRowBadges(
      makeRow({
        identity: STALE_IDENTITY,
        commercial: {
          price: '100.00',
          currency: 'PLN',
          availableQuantity: 0,
          lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
        },
      }),
    );

    expect(badges[0]).toMatchObject({ label: 'Product deleted', tone: 'error', solid: false });
    expect(badges[0]?.title).toMatch(/the pause took effect/i);
  });

  // The third branch: no commercial snapshot exists at all, which on a
  // connection whose status-sync task is off is EVERY row.
  it('should not claim a stale offer was paused when no channel quantity was ever read', () => {
    const badges = listingRowBadges(makeRow({ identity: STALE_IDENTITY, commercial: null }));

    expect(badges[0]).toMatchObject({ label: 'Product deleted', tone: 'error', solid: false });
    expect(badges[0]?.title).toMatch(/not known whether this offer was paused/i);
    expect(badges[0]?.title).not.toMatch(/should have been paused|pause took effect/i);
  });

  it('should badge a mapping with no linked variant, escalating when it still has channel stock', () => {
    const paused = listingRowBadges(
      makeRow({
        identity: null,
        commercial: {
          price: '100.00',
          currency: 'PLN',
          availableQuantity: 0,
          lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
        },
      }),
    );
    const selling = listingRowBadges(makeRow({ identity: null }));

    expect(paused[0]).toMatchObject({ id: 'unlinked', tone: 'error', solid: false });
    expect(selling[0]).toMatchObject({ id: 'unlinked', tone: 'error', solid: true });
  });

  it('should leave an absent identity projection unbadged, since absence is not a missing variant', () => {
    // `undefined` = the detail endpoint does not populate identity at all.
    expect(listingRowBadges(makeRow({ identity: undefined })).map((b) => b.id)).not.toContain(
      'unlinked',
    );
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
          lifecycle: 'Invalid',
          validationMessages: ['Zdjęcie główne poniżej wymaganej rozdzielczości'],
          lastStatusSyncedAt: '2026-07-20T22:40:00.000Z',
        },
      }),
    );

    expect(badges.map((b) => b.label)).toEqual(['Selling deleted product', 'Invalid']);
  });
});

describe('isUnlinked', () => {
  it('should be true only for an explicitly null identity projection', () => {
    expect(isUnlinked(makeRow({ identity: null }))).toBe(true);
    expect(isUnlinked(makeRow({ identity: undefined }))).toBe(false);
    expect(isUnlinked(makeRow())).toBe(false);
  });
});

describe('isOverselling', () => {
  it('should be false when the quantity is not reported, never treating null as stock', () => {
    expect(
      isOverselling(
        makeRow({
          identity: STALE_IDENTITY,
          commercial: {
            price: '100.00',
            currency: 'PLN',
            availableQuantity: null,
            lastCommercialSyncedAt: '2026-07-21T02:10:00.000Z',
          },
        }),
      ),
    ).toBe(false);
  });

  it('should be false when no commercial snapshot was ever persisted', () => {
    expect(isOverselling(makeRow({ identity: STALE_IDENTITY, commercial: null }))).toBe(false);
  });

  it('should be false for a live variant with stock', () => {
    expect(isOverselling(makeRow())).toBe(false);
  });
});

describe('listingRowAlert', () => {
  it('should return no alert for a healthy row', () => {
    expect(listingRowAlert(makeRow())).toBeNull();
  });

  it('should surface the first validator message verbatim, counting the rest', () => {
    // A snapshot written before #2231 (and any older API build) carries only the
    // flat message list. It still renders - and now says how many it is hiding.
    const alert = listingRowAlert(
      makeRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Invalid',
          validationMessages: ['Brak wymaganego parametru: Materiał', 'second'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(alert?.text).toBe('Brak wymaganego parametru: Materiał · +1 more problem');
  });

  it('should outrank a validator message with the overselling warning', () => {
    const alert = listingRowAlert(
      makeRow({
        identity: STALE_IDENTITY,
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Invalid',
          validationMessages: ['Brak wymaganego parametru: Materiał'],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(alert?.text).toBe('Still 41 available on channel - the master product no longer exists');
  });

  it('should warn when an unlinked mapping still has channel stock', () => {
    const alert = listingRowAlert(makeRow({ identity: null }));

    expect(alert?.text).toBe(
      'Still 41 available on channel - no OpenLinker product is linked to this listing',
    );
  });

  it('should not invent an overselling line when the quantity was never read', () => {
    expect(listingRowAlert(makeRow({ identity: null, commercial: null }))).toBeNull();
    expect(listingRowAlert(makeRow({ identity: STALE_IDENTITY, commercial: null }))).toBeNull();
  });

  it('should prefer a structured problem summary over its full sentence (#2231)', () => {
    const alert = listingRowAlert(makeRow({ channelStatus: blockedStatus() }));

    expect(alert?.text).toBe('No VAT rate set on Erli');
    expect(alert?.muted).toBe(false);
  });

  it('should count the problems it could not show, on one line (#2231)', () => {
    const alert = listingRowAlert(
      makeRow({
        channelStatus: blockedStatus([
          problem('missingTaxRate', 'No VAT rate set on Erli', 'Set the tax rate.'),
          problem('delivery', 'No delivery price list assigned', 'Pick a price list.'),
        ]),
      }),
    );

    expect(alert?.text).toBe('No VAT rate set on Erli · +1 more problem');
    // The full list is what the hover carries; the line stays single-line.
    expect(alert?.title).toBe('Set the tax rate.\nPick a price list.');
    expect(alert?.text).not.toContain('\n');
  });

  it('should pluralise the overflow count (#2231)', () => {
    const alert = listingRowAlert(
      makeRow({
        channelStatus: blockedStatus([
          problem('missingTaxRate', 'No VAT rate set on Erli', 'a'),
          problem('delivery', 'No delivery price list assigned', 'b'),
          problem('image', 'No usable product image', 'c'),
        ]),
      }),
    );

    expect(alert?.text).toBe('No VAT rate set on Erli · +2 more problems');
  });

  it('should keep a shop-level problem off the row and point at the notice (#2231)', () => {
    const alert = listingRowAlert(
      makeRow({
        channelStatus: blockedStatus([
          {
            code: 'shopKyc',
            summary: 'Shop verification incomplete',
            message: 'Finish it.',
            scope: 'account',
          },
        ]),
      }),
    );

    // Repeating it per row would stamp one sentence on every row.
    expect(alert?.text).toBe('Blocked by a problem with the shop, not this listing');
    expect(alert?.muted).toBe(true);
  });

  it('should say an inactive offer has nothing outstanding, quietly (#2231)', () => {
    const alert = listingRowAlert(
      makeRow({
        channelStatus: {
          publicationStatus: 'inactive',
          lifecycle: 'Draft',
          validationMessages: [],
          validationProblems: [],
          lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
        },
      }),
    );

    expect(alert?.text).toBe('Set to inactive on the channel, no problems reported');
    expect(alert?.muted).toBe(true);
  });

  it('should stay silent on an active row with nothing wrong (#2231)', () => {
    expect(listingRowAlert(makeRow())).toBeNull();
  });
});

function problem(code: string, summary: string, message: string): OfferValidationProblem {
  return { code, summary, message, scope: 'offer' };
}

function blockedStatus(
  problems: OfferValidationProblem[] = [
    problem('missingTaxRate', 'No VAT rate set on Erli', 'Set the tax rate on the product.'),
  ],
): OfferMappingChannelStatus {
  return {
    publicationStatus: 'inactive',
    lifecycle: 'Invalid',
    // Both halves are written together by the backend, and the flat list is what
    // an older build would send on its own.
    validationMessages: problems.map((entry) => entry.message),
    validationProblems: problems,
    lastStatusSyncedAt: '2026-07-20T23:12:00.000Z',
  };
}
