/**
 * Amazon buyer data window policy tests
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { isWithinAmazonBuyerDataWindow } from '../amazon-buyer-data-window.policy';

const NOW = new Date('2026-11-17T12:00:00.000Z');

describe('isWithinAmazonBuyerDataWindow', () => {
  it('should measure from the ship-by deadline when Amazon reports one', () => {
    expect(
      isWithinAmazonBuyerDataWindow({ createdTime: '2026-10-01T00:00:00Z', shipByLatest: '2026-10-20T00:00:00Z' }, NOW),
    ).toBe(true);
    expect(
      isWithinAmazonBuyerDataWindow({ createdTime: '2026-10-01T00:00:00Z', shipByLatest: '2026-10-10T00:00:00Z' }, NOW),
    ).toBe(false);
  });

  it('should fall back to the placement time without a ship-by deadline', () => {
    expect(isWithinAmazonBuyerDataWindow({ createdTime: '2026-11-01T00:00:00Z' }, NOW)).toBe(true);
    expect(isWithinAmazonBuyerDataWindow({ createdTime: '2026-10-01T00:00:00Z' }, NOW)).toBe(false);
  });

  it('should treat an order whose times cannot be read as inside the window', () => {
    expect(isWithinAmazonBuyerDataWindow({ createdTime: 'not-a-time' }, NOW)).toBe(true);
  });
});
