import type { ShopifyReturnLineNode, ShopifyReturnNode } from '../../../domain/types/shopify-return.types';
import { mapShopifyReturnToIncoming } from '../shopify-incoming-return.mapper';

function returnLine(overrides: Partial<ShopifyReturnLineNode> = {}): ShopifyReturnLineNode {
  return {
    __typename: 'ReturnLineItem',
    id: 'gid://shopify/ReturnLineItem/501',
    quantity: 1,
    returnReasonDefinition: { handle: 'size-too-small', name: 'Size too small' },
    fulfillmentLineItem: {
      lineItem: {
        id: 'gid://shopify/LineItem/31',
        sku: 'TSHIRT-L',
        name: 'T-shirt - L',
        variant: { id: 'gid://shopify/ProductVariant/41' },
        discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: '76.49', currencyCode: 'PLN' } },
      },
    },
    ...overrides,
  };
}

function shopifyReturn(overrides: Partial<ShopifyReturnNode> = {}): ShopifyReturnNode {
  return {
    __typename: 'Return',
    id: 'gid://shopify/Return/77',
    name: '#1019-R1',
    status: 'OPEN',
    createdAt: '2026-11-05T10:00:00Z',
    order: { id: 'gid://shopify/Order/1019', name: '#1019' },
    returnLineItems: { nodes: [returnLine()] },
    ...overrides,
  };
}

describe('mapShopifyReturnToIncoming', () => {
  it('should carry the return with its order, raw status and each line as the source reports it', () => {
    const incoming = mapShopifyReturnToIncoming(shopifyReturn());

    expect(incoming).toMatchObject({
      externalReturnId: '77',
      externalOrderId: '1019',
      referenceNumber: '#1019-R1',
      rawStatus: 'OPEN',
      createdAt: '2026-11-05T10:00:00Z',
      isTerminalAtSource: false,
    });
    expect(incoming.lines).toEqual([
      expect.objectContaining({
        externalLineId: '501',
        sku: 'TSHIRT-L',
        name: 'T-shirt - L',
        quantity: 1,
        unitPrice: 76.49,
        reasonRaw: 'size-too-small',
      }),
    ]);
  });

  it('should leave the offer id unset so core matches the line by sku', () => {
    const incoming = mapShopifyReturnToIncoming(shopifyReturn());

    expect(incoming.lines[0]).not.toHaveProperty('offerId');
  });

  it.each(['CLOSED', 'DECLINED', 'CANCELED'])('should mark a %s return as terminal at the source', (status) => {
    expect(mapShopifyReturnToIncoming(shopifyReturn({ status })).isTerminalAtSource).toBe(true);
  });

  it('should keep an unverified line with its quantity and no identity, so the return is not reported smaller', () => {
    const incoming = mapShopifyReturnToIncoming(
      shopifyReturn({
        returnLineItems: {
          nodes: [{ __typename: 'UnverifiedReturnLineItem', id: 'gid://shopify/UnverifiedReturnLineItem/9', quantity: 2 }],
        },
      }),
    );

    expect(incoming.lines).toEqual([expect.objectContaining({ externalLineId: '9', quantity: 2 })]);
    expect(incoming.lines[0]).not.toHaveProperty('sku');
    expect(incoming.lines[0]).not.toHaveProperty('unitPrice');
    expect(incoming.lines[0]).not.toHaveProperty('reasonRaw');
  });

  it('should report a return with no order as unattributed rather than guessing one', () => {
    expect(mapShopifyReturnToIncoming(shopifyReturn({ order: null })).externalOrderId).toBeNull();
  });
});
