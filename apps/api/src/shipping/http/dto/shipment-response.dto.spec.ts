/**
 * ShipmentResponseDto unit tests (#1995 — orderSummary projection).
 */
import { Shipment } from '@openlinker/core/shipping';
import { ShipmentResponseDto } from './shipment-response.dto';
import type { OrderSummary } from '@openlinker/core/orders';

function makeShipment(): Shipment {
  return new Shipment(
    'ol_shipment_1',
    'ol_order_1',
    'b3f1c2d4-0000-4000-8000-000000000001',
    'paczkomat',
    'generated',
    'shipx-1',
    'POZ08A',
    '6800000001',
    'shipx:label:1',
    null,
    null,
    null,
    null,
    null,
    new Date('2026-05-20T10:00:00.000Z'),
    new Date('2026-05-20T10:00:00.000Z'),
    null,
    null,
    null,
    null,
    null,
    'outbound',
    null,
    // #2402 fulfillmentWorkId — no work linkage in this fixture.
    null,
  );
}

describe('ShipmentResponseDto.fromDomain', () => {
  it('sets orderSummary to null when no summary is supplied', () => {
    const dto = ShipmentResponseDto.fromDomain(makeShipment(), null, true, null);
    expect(dto.orderSummary).toBeNull();
  });

  it('maps a supplied OrderSummary onto the DTO', () => {
    const summary: OrderSummary = {
      orderNumber: 'ORD-001',
      firstItemName: 'Terra Wool Coat',
      firstItemImageUrl: 'https://example.com/coat.png',
      itemCount: 2,
    };

    const dto = ShipmentResponseDto.fromDomain(makeShipment(), null, true, summary);

    expect(dto.orderSummary).toEqual(summary);
  });
});
