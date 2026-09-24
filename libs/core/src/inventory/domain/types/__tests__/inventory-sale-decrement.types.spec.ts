/**
 * Inventory Sale Decrement Types — spec (#3453)
 */
import type { InventoryOwnerPosition } from '../inventory.types';
import {
  buildSaleDecrementIdempotencyKey,
  buildUnresolvedSaleDecrementKey,
  deriveSaleDecrementAttention,
  resolveSaleDecrementOwner,
} from '../inventory-sale-decrement.types';

const position = (overrides: Partial<InventoryOwnerPosition> = {}): InventoryOwnerPosition => ({
  inventoryItemId: 'inv-1',
  productId: 'ol_product_1',
  productVariantId: 'ol_variant_1',
  locationId: null,
  sourceConnectionId: 'conn-shop',
  availableQuantity: 5,
  reservedQuantity: 0,
  ...overrides,
});

const line = {
  productId: 'ol_product_1',
  productVariantId: 'ol_variant_1',
  locationId: 'loc-main',
};

describe('buildSaleDecrementIdempotencyKey', () => {
  it('should build the per-owner key the issue specifies', () => {
    expect(buildSaleDecrementIdempotencyKey('conn-shop', 'w-1', 'line-1')).toBe(
      'sale:conn-shop:w-1:line-1'
    );
  });

  it('should keep an unresolved line in its own namespace', () => {
    expect(buildUnresolvedSaleDecrementKey('w-1', 'line-1')).toBe('sale:unresolved:w-1:line-1');
  });
});

describe('resolveSaleDecrementOwner', () => {
  it('should resolve the single owner of a pooled position', () => {
    const resolution = resolveSaleDecrementOwner([position()], line);

    expect(resolution).toEqual({
      kind: 'owner',
      ownerConnectionId: 'conn-shop',
      position: position(),
      availableQuantity: 5,
    });
  });

  it('should accept a position located at the work location', () => {
    const located = position({ locationId: 'loc-main' });

    const resolution = resolveSaleDecrementOwner([located], line);

    expect(resolution).toMatchObject({ kind: 'owner', position: located });
  });

  it('should ignore a position at a different location', () => {
    const resolution = resolveSaleDecrementOwner([position({ locationId: 'loc-other' })], line);

    expect(resolution).toMatchObject({ kind: 'blocked', reason: 'no-position' });
  });

  it('should block with no-position when the product has no live position', () => {
    expect(resolveSaleDecrementOwner([], line)).toMatchObject({
      kind: 'blocked',
      reason: 'no-position',
    });
  });

  it.each([
    ['NULL', null],
    ['legacy', 'legacy'],
  ])('should refuse an owner with %s provenance', (_label, sourceConnectionId) => {
    const resolution = resolveSaleDecrementOwner([position({ sourceConnectionId })], line);

    expect(resolution).toMatchObject({ kind: 'blocked', reason: 'unattributed-owner' });
  });

  it('should refuse two owners for one variant rather than guess', () => {
    const resolution = resolveSaleDecrementOwner(
      [
        position({ inventoryItemId: 'inv-1', sourceConnectionId: 'conn-shop' }),
        position({ inventoryItemId: 'inv-2', sourceConnectionId: 'conn-subiekt' }),
      ],
      line
    );

    expect(resolution).toMatchObject({ kind: 'blocked', reason: 'ambiguous-owner' });
  });

  // A mixed basket: each line resolves its OWN owner, never a global one.
  it('should resolve each product to its own owner in a two-master basket', () => {
    const positions = [
      position({ productId: 'ol_product_1', sourceConnectionId: 'conn-shop' }),
      position({
        inventoryItemId: 'inv-2',
        productId: 'ol_product_2',
        productVariantId: 'ol_variant_2',
        sourceConnectionId: 'conn-subiekt',
      }),
    ];

    expect(resolveSaleDecrementOwner(positions, line)).toMatchObject({
      ownerConnectionId: 'conn-shop',
    });
    expect(
      resolveSaleDecrementOwner(positions, {
        productId: 'ol_product_2',
        productVariantId: 'ol_variant_2',
        locationId: 'loc-main',
      })
    ).toMatchObject({ ownerConnectionId: 'conn-subiekt' });
  });

  it('should fall back to the product-level position when the variant has none', () => {
    const productLevel = position({ productVariantId: null });

    const resolution = resolveSaleDecrementOwner([productLevel], line);

    expect(resolution).toMatchObject({ kind: 'owner', position: productLevel });
  });

  it('should prefer the variant position over a product-level one', () => {
    const variantRow = position({ inventoryItemId: 'inv-variant' });
    const productLevel = position({ inventoryItemId: 'inv-product', productVariantId: null });

    const resolution = resolveSaleDecrementOwner([productLevel, variantRow], line);

    expect(resolution).toMatchObject({ kind: 'owner', position: variantRow });
  });

  it('should write back to the located position and clamp against the sum of both', () => {
    const pooled = position({ inventoryItemId: 'inv-pooled', availableQuantity: 1 });
    const located = position({
      inventoryItemId: 'inv-located',
      locationId: 'loc-main',
      availableQuantity: 2,
    });

    const resolution = resolveSaleDecrementOwner([pooled, located], line);

    expect(resolution).toMatchObject({ kind: 'owner', position: located, availableQuantity: 3 });
  });
});

describe('deriveSaleDecrementAttention', () => {
  it('should report nothing when every line was lowered or skipped', () => {
    expect(
      deriveSaleDecrementAttention([
        { status: 'applied', clamped: false },
        { status: 'deduplicated', clamped: false },
        { status: 'skipped', clamped: false },
      ])
    ).toEqual({ kind: 'none' });
  });

  it.each(['blocked', 'in_doubt', 'retryable'] as const)(
    'should raise attention for a %s line',
    (status) => {
      expect(deriveSaleDecrementAttention([{ status, clamped: false }])).toEqual({
        kind: 'blocked',
        detail: '1 line(s) not lowered or in doubt',
      });
    }
  );

  it('should raise attention for a clamped decrement', () => {
    expect(deriveSaleDecrementAttention([{ status: 'applied', clamped: true }])).toEqual({
      kind: 'blocked',
      detail: '1 line(s) sold more than the stock OpenLinker saw',
    });
  });

  // Level-triggered over the whole order: one work's success never hides
  // another work's failure.
  it('should keep a sibling line failure visible next to a success', () => {
    expect(
      deriveSaleDecrementAttention([
        { status: 'applied', clamped: false },
        { status: 'in_doubt', clamped: false },
      ])
    ).toMatchObject({ kind: 'blocked' });
  });

  it('should report nothing for an order with no decrement rows', () => {
    expect(deriveSaleDecrementAttention([])).toEqual({ kind: 'none' });
  });
});
