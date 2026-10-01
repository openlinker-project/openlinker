import { mapShoperStockToInventory, readShoperStockLevel } from '../shoper-inventory.mapper';

describe('shoper-inventory.mapper', () => {
  it.each([
    ['74', 74],
    ['0', 0],
    ['2.5', 2.5],
  ])('should read stock %p as %p', (stock, expected) => {
    expect(readShoperStockLevel({ stock })).toBe(expected);
  });

  it.each([[''], ['abc'], [undefined as unknown as string]])(
    'should read an unreadable stock %p as null, never 0',
    (stock) => {
      expect(readShoperStockLevel({ stock })).toBeNull();
    },
  );

  it('should map to a pooled inventory with nothing reserved', () => {
    expect(
      mapShoperStockToInventory(7, { productId: 'p', variantId: 'v', inventoryId: 'i' }),
    ).toEqual({
      id: 'i',
      productId: 'p',
      variantId: 'v',
      locationId: undefined,
      quantity: 7,
      reserved: 0,
      available: 7,
      updatedAt: undefined,
    });
  });
});
