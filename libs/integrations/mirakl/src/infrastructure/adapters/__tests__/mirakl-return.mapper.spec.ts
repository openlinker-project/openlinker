/**
 * Mirakl Return Mapper: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { mapMiraklReturn } from '../mirakl-return.mapper';
import { buildMiraklOrder } from './mirakl-order.fixture';
import { buildMiraklReturn } from './mirakl-return.fixture';

describe('mapMiraklReturn', () => {
  it('should take the line SKU, name and price from the order, and keep the reason verbatim', () => {
    const order = buildMiraklOrder({
      order_lines: [
        {
          order_line_id: '1001-A-1',
          offer_sku: 'SKU-RED-M',
          product_title: 'Shirt',
          price_unit: 49.99,
        },
      ],
    });

    expect(mapMiraklReturn(buildMiraklReturn(), order)).toMatchObject({
      externalReturnId: 'R-1001',
      externalOrderId: '1001-A',
      referenceNumber: 'RMA-77',
      rawStatus: 'WAITING_ACCEPTANCE',
      createdAt: '2026-11-23T10:00:00Z',
      isTerminalAtSource: false,
      lines: [
        {
          externalLineId: '1001-A-1',
          offerId: 'SKU-RED-M',
          sku: 'SKU-RED-M',
          name: 'Shirt',
          quantity: 1,
          unitPrice: 49.99,
          reasonRaw: 'RETURN_BROKEN_ITEM',
        },
      ],
    });
  });

  it('should still report the lines without the order, taking the return reason when a line has none', () => {
    const mapped = mapMiraklReturn(
      buildMiraklReturn({ return_lines: [{ order_line_id: 'x', quantity: 2 }] }),
      null
    );

    expect(mapped.lines).toEqual([
      {
        externalLineId: 'x',
        quantity: 2,
        reasonRaw: 'RETURN_CHANGED_MIND',
        raw: { order_line_id: 'x', quantity: 2 },
      },
    ]);
  });

  it.each([
    ['CLOSED', true],
    ['REFUSED', true],
    ['CANCELED', true],
    ['RECEIVED', false],
    ['NO_RECEPTION', false],
  ])('should mark %s terminal at source: %s', (state, terminal) => {
    expect(mapMiraklReturn(buildMiraklReturn({ state }), null).isTerminalAtSource).toBe(terminal);
  });
});
