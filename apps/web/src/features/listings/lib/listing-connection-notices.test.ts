import { describe, expect, it } from 'vitest';
import type { OfferMapping, OfferValidationProblem } from '../api/listings.types';
import { deriveListingConnectionNotices } from './listing-connection-notices';

const SHOP_KYC: OfferValidationProblem = {
  code: 'shopKyc',
  summary: 'Shop verification incomplete',
  message: 'Finish verification in the Erli seller panel.',
  scope: 'account',
};
const BLOCKED: OfferValidationProblem = {
  code: 'blocked',
  summary: 'Blocked by Erli',
  message: 'Contact Erli support.',
  scope: 'account',
};
const OFFER_PROBLEM: OfferValidationProblem = {
  code: 'missingTaxRate',
  summary: 'No VAT rate set on Erli',
  message: 'Set the tax rate.',
  scope: 'offer',
};

function makeRow(
  id: string,
  connectionId: string,
  problems: OfferValidationProblem[]
): OfferMapping {
  return {
    id,
    entityType: 'Offer',
    internalId: `ol_variant_${id}`,
    externalId: id,
    platformType: 'erli',
    connectionId,
    context: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    identity: null,
    channelStatus: {
      publicationStatus: 'inactive',
      lifecycle: 'Invalid',
      validationMessages: problems.map((problem) => problem.message),
      validationProblems: problems,
      lastStatusSyncedAt: '2026-08-20T01:00:00.000Z',
    },
    commercial: null,
  };
}

const NAMES = new Map([
  ['conn-1', 'Erli Demo'],
  ['conn-2', 'Erli Second'],
]);

describe('deriveListingConnectionNotices (#2231)', () => {
  it('should raise no notice when nothing is shop-level', () => {
    expect(
      deriveListingConnectionNotices([makeRow('a', 'conn-1', [OFFER_PROBLEM])], NAMES)
    ).toEqual([]);
    expect(deriveListingConnectionNotices([], NAMES)).toEqual([]);
  });

  it('should collapse the same shop-level problem across every affected row', () => {
    // Every affected row repeats the identical list - that repetition is the
    // whole reason the notice exists.
    const notices = deriveListingConnectionNotices(
      [
        makeRow('a', 'conn-1', [SHOP_KYC, OFFER_PROBLEM]),
        makeRow('b', 'conn-1', [SHOP_KYC]),
        makeRow('c', 'conn-1', [SHOP_KYC]),
      ],
      NAMES
    );

    expect(notices).toHaveLength(1);
    expect(notices[0].connectionLabel).toBe('Erli Demo');
    expect(notices[0].problems).toEqual([SHOP_KYC]);
    expect(notices[0].affectedShownCount).toBe(3);
  });

  it('should keep two shop-level problems on the same connection', () => {
    const notices = deriveListingConnectionNotices(
      [makeRow('a', 'conn-1', [SHOP_KYC, BLOCKED])],
      NAMES
    );

    expect(notices[0].problems.map((problem) => problem.code)).toEqual(['shopKyc', 'blocked']);
  });

  it('should raise one notice per connection, in first-seen order', () => {
    const notices = deriveListingConnectionNotices(
      [
        makeRow('a', 'conn-2', [BLOCKED]),
        makeRow('b', 'conn-1', [SHOP_KYC]),
        makeRow('c', 'conn-2', [BLOCKED]),
      ],
      NAMES
    );

    expect(notices.map((notice) => [notice.connectionId, notice.affectedShownCount])).toEqual([
      ['conn-2', 2],
      ['conn-1', 1],
    ]);
  });

  it('should fall back to the connection id when its name is not loaded yet', () => {
    const notices = deriveListingConnectionNotices([makeRow('a', 'conn-9', [SHOP_KYC])], new Map());

    // Never a platform label: two Erli connections would render identically.
    expect(notices[0].connectionLabel).toBe('conn-9');
  });

  it('should not count a row whose problems are all offer-scoped', () => {
    const notices = deriveListingConnectionNotices(
      [makeRow('a', 'conn-1', [SHOP_KYC]), makeRow('b', 'conn-1', [OFFER_PROBLEM])],
      NAMES
    );

    expect(notices[0].affectedShownCount).toBe(1);
  });
});
