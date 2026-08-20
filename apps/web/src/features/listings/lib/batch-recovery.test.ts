import { describe, expect, it } from 'vitest';
import {
  buildBatchFixUrl,
  describeBatchFixBlocker,
  MAX_WIZARD_PRODUCTS,
  resolveBatchFixTarget,
  selectFailedRecords,
} from './batch-recovery';
import type { BulkBatchRecordSummary } from '../api/bulk-listings.types';

function record(overrides: Partial<BulkBatchRecordSummary> = {}): BulkBatchRecordSummary {
  return {
    id: 'rec_1',
    internalVariantId: 'ol_variant_1',
    status: 'failed',
    externalOfferId: null,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:01:00.000Z',
    errors: null,
    productId: 'ol_product_1',
    ...overrides,
  };
}

describe('selectFailedRecords', () => {
  it('should return only failed records when the batch is mixed', () => {
    const records = [
      record({ id: 'a', status: 'active' }),
      record({ id: 'b', status: 'failed' }),
      record({ id: 'c', status: 'pending' }),
    ];

    expect(selectFailedRecords(records).map((r) => r.id)).toEqual(['b']);
  });
});

describe('resolveBatchFixTarget', () => {
  it('should dedupe product ids and keep every variant id when records share a product', () => {
    const target = resolveBatchFixTarget([
      record({ id: 'a', internalVariantId: 'v1', productId: 'p1' }),
      record({ id: 'b', internalVariantId: 'v2', productId: 'p1' }),
    ]);

    expect(target.productIds).toEqual(['p1']);
    expect(target.variantIds).toEqual(['v1', 'v2']);
    expect(target.blocker).toBeNull();
  });

  it('should block with no-product-link when no record carries a product id', () => {
    const target = resolveBatchFixTarget([
      record({ productId: null }),
      record({ id: 'b', productId: undefined }),
    ]);

    expect(target.productIds).toEqual([]);
    expect(target.blocker).toBe('no-product-link');
  });

  it('should ignore records without a product link when siblings have one', () => {
    const target = resolveBatchFixTarget([
      record({ id: 'a', internalVariantId: 'v1', productId: null }),
      record({ id: 'b', internalVariantId: 'v2', productId: 'p2' }),
    ]);

    expect(target.productIds).toEqual(['p2']);
    expect(target.variantIds).toEqual(['v1', 'v2']);
    expect(target.blocker).toBeNull();
  });

  it('should block with over-product-cap when the deduped product count exceeds the wizard cap', () => {
    const records = Array.from({ length: MAX_WIZARD_PRODUCTS + 1 }, (_, i) =>
      record({ id: `r${i.toString()}`, internalVariantId: `v${i.toString()}`, productId: `p${i.toString()}` }),
    );

    expect(resolveBatchFixTarget(records).blocker).toBe('over-product-cap');
  });

  it('should block with no-product-link when there are no records at all', () => {
    expect(resolveBatchFixTarget([]).blocker).toBe('no-product-link');
  });
});

describe('buildBatchFixUrl', () => {
  it('should carry products, variants, connection and the originating batch', () => {
    const url = buildBatchFixUrl({
      productIds: ['p1', 'p2'],
      variantIds: ['v1', 'v2'],
      connectionId: 'conn_1',
      batchId: 'batch_1',
    });

    const query = new URLSearchParams(url.slice(url.indexOf('?')));
    expect(url.startsWith('/listings/bulk-create/wizard?')).toBe(true);
    expect(query.get('productIds')).toBe('p1,p2');
    expect(query.get('variantIds')).toBe('v1,v2');
    expect(query.get('connectionId')).toBe('conn_1');
    expect(query.get('fromBatch')).toBe('batch_1');
  });
});

describe('describeBatchFixBlocker', () => {
  it('should state the reason and that retry still works for every blocker', () => {
    expect(describeBatchFixBlocker('no-product-link')).toContain('Retry is unaffected.');
    expect(describeBatchFixBlocker('over-product-cap')).toContain('Retry is unaffected.');
  });
});
