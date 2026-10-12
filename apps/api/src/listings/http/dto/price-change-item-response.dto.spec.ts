/**
 * PriceChangeItemResponseDto mapping tests (#3737, ADR-077) - the queue item's
 * `cause` reaches the wire, so the review queue can tell a tax-basis
 * correction (never auto-applied) from an ordinary price move.
 *
 * @module apps/api/src/listings/http/dto
 */
import type { PriceChangeQueueItem } from '@openlinker/core/listings';

import { PriceChangeItemResponseDto } from './price-change-item-response.dto';

const baseItem: PriceChangeQueueItem = {
  id: 'ep-1',
  productVariantId: 'ol_variant_1',
  productName: 'Chair',
  variantLabel: null,
  sku: 'sku-1',
  sourceConnectionId: 'src-1',
  sourceLabel: 'PrestaShop',
  sourceOldAmount: 100,
  sourceNewAmount: 123,
  sourceCurrency: 'PLN',
  destinationConnectionId: 'dest-1',
  destinationLabel: 'Allegro',
  destinationCurrency: 'PLN',
  computedOldAmount: 100,
  computedNewAmount: 123,
  deltaPct: 23,
  isSteep: true,
  ruleSummary: { type: 'passthrough', percent: 0, rounding: 'none' },
  blockReason: null,
  cause: null,
  needsRefresh: false,
  version: '2026-10-12T10:00:00.000Z',
  manualPriceOverride: null,
  resolution: null,
  resolvedAt: null,
  resolvedByUserId: null,
  detectedAt: '2026-10-12T10:00:00.000Z',
};

describe('PriceChangeItemResponseDto.fromDomain', () => {
  it('should carry the tax-basis-correction cause when the episode is a correction', () => {
    const dto = PriceChangeItemResponseDto.fromDomain({
      ...baseItem,
      cause: 'tax-basis-correction',
    });

    expect(dto.cause).toBe('tax-basis-correction');
    expect(dto.blockReason).toBeNull();
  });

  it('should report a null cause when the episode is an ordinary price move', () => {
    const dto = PriceChangeItemResponseDto.fromDomain(baseItem);

    expect(dto.cause).toBeNull();
  });
});
