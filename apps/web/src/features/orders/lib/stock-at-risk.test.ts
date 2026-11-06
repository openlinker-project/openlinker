/**
 * Stock-at-risk text tests (#2350).
 *
 * The builders are the single source AC1 rests on, so their edges are tested
 * here rather than only through the components that render them.
 */
import { describe, expect, it } from 'vitest';
import { formatPlural, getMessages } from '../../../shared/i18n';
import {
  shortfallItemLabel,
  stockAtRiskBadge,
  stockAtRiskCallout,
  stockAtRiskTitle,
} from './stock-at-risk';
import type { StockAtRiskText } from './stock-at-risk.types';
import type { OrderReservationShortfall } from '../api/orders.types';

const text: StockAtRiskText = {
  copy: getMessages('orders').stockAtRisk,
  plural: (count, forms, params) => formatPlural(count, forms, 'en', params),
  number: (value) => String(value),
};

function shortfall(over: Partial<OrderReservationShortfall> = {}): OrderReservationShortfall {
  return {
    episodeId: 'ep-1',
    inventoryItemId: 'ol_inventoryitem_1',
    productVariantId: 'ol_variant_1',
    sku: 'SKU-1',
    shortQuantity: 2,
    positionShortfall: 3,
    openedAt: '2026-08-27T10:00:00.000Z',
    ...over,
  };
}

describe('shortfallItemLabel', () => {
  it('should prefer the sku', () => {
    expect(shortfallItemLabel(shortfall())).toBe('SKU-1');
  });

  it('should fall back to the variant id when the sku is null', () => {
    expect(shortfallItemLabel(shortfall({ sku: null }))).toBe('ol_variant_1');
  });

  it('should fall back to the position id rather than ever returning a blank', () => {
    // An operator who cannot see WHICH item is short cannot act; an internal id
    // they can paste into a search beats an empty gap.
    expect(shortfallItemLabel(shortfall({ sku: null, productVariantId: null }))).toBe(
      'ol_inventoryitem_1'
    );
  });
});

describe('stockAtRiskTitle', () => {
  it('should return null for an empty list', () => {
    expect(stockAtRiskTitle([], text)).toBeNull();
  });

  it('should name the item for a single episode', () => {
    expect(stockAtRiskTitle([shortfall()], text)).toBe('Short 2 × SKU-1');
  });

  it('should summarise for several episodes', () => {
    expect(stockAtRiskTitle([shortfall(), shortfall({ episodeId: 'ep-2' })], text)).toBe(
      'Short stock on 2 items'
    );
  });
});

describe('stockAtRiskBadge', () => {
  it('should return null for an empty or absent list', () => {
    // Absence is indistinguishable from a failed projection, so neither may
    // produce a positive claim.
    expect(stockAtRiskBadge([], text)).toBeNull();
    expect(stockAtRiskBadge(undefined, text)).toBeNull();
  });

  it('should be warning-toned: at risk is not broken', () => {
    // Reserving `error` for real failures is what keeps a red row meaning
    // outstanding work.
    expect(stockAtRiskBadge([shortfall()], text)?.tone).toBe('warning');
  });

  it('should carry the body sentence in its title', () => {
    expect(stockAtRiskBadge([shortfall()], text)?.title).toContain(text.copy.body);
  });
});

describe('stockAtRiskCallout', () => {
  it('should return null for an empty or absent list', () => {
    expect(stockAtRiskCallout([], text)).toBeNull();
    expect(stockAtRiskCallout(undefined, text)).toBeNull();
  });

  it('should share its title with the badge', () => {
    const list = [shortfall()];

    expect(stockAtRiskCallout(list, text)?.title).toBe(stockAtRiskBadge(list, text)?.label);
  });

  it('should list one line per episode', () => {
    const list = [shortfall(), shortfall({ episodeId: 'ep-2', sku: 'SKU-2' })];

    expect(stockAtRiskCallout(list, text)?.lines).toHaveLength(2);
  });
});

describe('stock-at-risk English copy', () => {
  it('should keep the shortfall sentences operators already read', () => {
    const list = [shortfall(), shortfall({ episodeId: 'ep-2', sku: 'SKU-2' })];

    expect(stockAtRiskCallout(list, text)?.lines[0]).toBe('SKU-1 - short 2 of 3 across all orders');
    expect(stockAtRiskTitle([shortfall({ shortQuantity: 1 })], text)).toBe('Short 1 × SKU-1');
  });
});
