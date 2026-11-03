/**
 * Inventory position owner — spec (#3486)
 */
import type { InventoryOwnerPosition } from '../inventory.types';
import { resolveInventoryPositionOwner } from '../inventory-owner.types';

const position = (overrides: Partial<InventoryOwnerPosition> = {}): InventoryOwnerPosition => ({
  inventoryItemId: 'inv-1',
  productId: 'p1',
  productVariantId: 'v1',
  locationId: null,
  sourceConnectionId: 'master-a',
  availableQuantity: 4,
  reservedQuantity: 0,
  ...overrides,
});

const query = { productId: 'p1', productVariantId: 'v1', locationId: null };

describe('resolveInventoryPositionOwner', () => {
  it('should name the single connection that owns the variant', () => {
    const result = resolveInventoryPositionOwner(
      [position(), position({ inventoryItemId: 'inv-2', productVariantId: 'v2', sourceConnectionId: 'master-b' })],
      query
    );

    expect(result).toMatchObject({ kind: 'owner', ownerConnectionId: 'master-a' });
  });

  it('should prefer variant rows over product-level rows', () => {
    const result = resolveInventoryPositionOwner(
      [
        position({ inventoryItemId: 'inv-product', productVariantId: null, sourceConnectionId: 'master-b' }),
        position(),
      ],
      query
    );

    expect(result).toMatchObject({ kind: 'owner', ownerConnectionId: 'master-a' });
  });

  it('should fall back to product-level rows when the variant has none', () => {
    const result = resolveInventoryPositionOwner(
      [position({ productVariantId: null, sourceConnectionId: 'master-b' })],
      query
    );

    expect(result).toMatchObject({ kind: 'owner', ownerConnectionId: 'master-b' });
  });

  it('should refuse with no-position when nothing matches', () => {
    expect(resolveInventoryPositionOwner([], query)).toEqual({
      kind: 'blocked',
      reason: 'no-position',
      ownerCount: 0,
    });
  });

  it.each([null, 'legacy'])('should refuse %p provenance as unattributed-owner', (sourceConnectionId) => {
    expect(resolveInventoryPositionOwner([position({ sourceConnectionId })], query)).toMatchObject({
      kind: 'blocked',
      reason: 'unattributed-owner',
    });
  });

  it('should refuse two owners of one variant as ambiguous-owner', () => {
    expect(
      resolveInventoryPositionOwner(
        [position(), position({ inventoryItemId: 'inv-2', sourceConnectionId: 'master-b' })],
        query
      )
    ).toEqual({ kind: 'blocked', reason: 'ambiguous-owner', ownerCount: 2 });
  });

  it('should only count positions at the requested location or pooled ones', () => {
    const result = resolveInventoryPositionOwner(
      [
        position({ locationId: 'loc-elsewhere', sourceConnectionId: 'master-b' }),
        position({ inventoryItemId: 'inv-2', locationId: 'loc-1' }),
      ],
      { ...query, locationId: 'loc-1' }
    );

    expect(result).toMatchObject({ kind: 'owner', ownerConnectionId: 'master-a' });
  });
});
