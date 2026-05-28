/**
 * Allegro Shipment Mapper — unit tests (#833)
 *
 * @module libs/integrations/allegro/src/infrastructure/mappers/__tests__
 */
import type { GenerateLabelCommand } from '@openlinker/core/shipping';

import { AllegroShipmentRejectedException } from '../../../domain/exceptions/allegro-shipment-rejected.exception';
import type { AllegroShipmentResource } from '../../../domain/types/allegro-shipment.types';
import {
  buildCreateShipmentInput,
  deriveCommandId,
  describeShipmentState,
  extractCarrierId,
  extractCarrierWaybill,
  formatCommandErrors,
  mapShipmentStateToStatus,
  normalizeAllegroCarrierId,
  toGenerateLabelResult,
} from '../allegro-shipment.mapper';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function makeCommand(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
  return {
    shipmentId: 'ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    orderId: 'ol_order_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    connectionId: 'conn-allegro',
    shippingMethod: 'kurier',
    deliveryMethodId: 'allegro-courier-uuid',
    recipient: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'buyer@allegromail.pl',
      phone: '+48500600700',
      address: {
        street: 'Krakowska',
        buildingNumber: '12',
        city: 'Poznań',
        postCode: '60-001',
        countryCode: 'PL',
      },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 },
    ...overrides,
  };
}

describe('deriveCommandId', () => {
  it('is deterministic for the same seed', () => {
    expect(deriveCommandId('ol_shipment_1')).toBe(deriveCommandId('ol_shipment_1'));
  });

  it('produces a valid v5-shaped UUID', () => {
    expect(deriveCommandId('ol_shipment_1')).toMatch(UUID_RE);
  });

  it('differs across seeds (distinct shipments / create vs cancel)', () => {
    expect(deriveCommandId('ol_shipment_1')).not.toBe(deriveCommandId('ol_shipment_2'));
    expect(deriveCommandId('ol_shipment_1')).not.toBe(deriveCommandId('cancel:ol_shipment_1'));
  });
});

describe('buildCreateShipmentInput', () => {
  it('maps a courier command: receiver address, mm→cm / g→kg packages, referenceNumber, deliveryMethodId', () => {
    const input = buildCreateShipmentInput(makeCommand());

    expect(input.deliveryMethodId).toBe('allegro-courier-uuid');
    expect(input.referenceNumber).toBe('ol_shipment_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(input.labelFormat).toBe('PDF');
    expect(input.sender).toBeUndefined(); // Allegro defaults sender from the account (#833 Q6)
    expect(input.receiver).toEqual({
      name: 'Jan Kowalski',
      email: 'buyer@allegromail.pl',
      phone: '+48500600700',
      street: 'Krakowska 12',
      postalCode: '60-001',
      city: 'Poznań',
      countryCode: 'PL',
    });
    expect(input.packages).toEqual([
      {
        type: 'PACKAGE',
        length: { value: 20, unit: 'CENTIMETER' },
        width: { value: 15, unit: 'CENTIMETER' },
        height: { value: 10, unit: 'CENTIMETER' },
        weight: { value: 1.2, unit: 'KILOGRAMS' },
      },
    ]);
  });

  it('sets receiver.point and prefers an explicit recipient.name for a paczkomat command', () => {
    const input = buildCreateShipmentInput(
      makeCommand({
        shippingMethod: 'paczkomat',
        paczkomatId: 'POZ08A',
        recipient: {
          name: 'ACME Sp. z o.o.',
          email: 'buyer@allegromail.pl',
          phone: '+48500600700',
        },
      }),
    );

    expect(input.receiver.point).toBe('POZ08A');
    expect(input.receiver.name).toBe('ACME Sp. z o.o.');
    expect(input.receiver.street).toBeUndefined();
  });

  it('throws a readable rejection when the resolved deliveryMethodId is absent', () => {
    expect(() => buildCreateShipmentInput(makeCommand({ deliveryMethodId: undefined }))).toThrow(
      AllegroShipmentRejectedException,
    );
  });

  it('throws when parcel dimensions are missing', () => {
    expect(() =>
      buildCreateShipmentInput(makeCommand({ parcel: { weightGrams: 1200 } })),
    ).toThrow(AllegroShipmentRejectedException);
  });

  it('throws when parcel weight is missing', () => {
    expect(() =>
      buildCreateShipmentInput(
        makeCommand({ parcel: { dimensions: { length: 200, width: 150, height: 100 } } }),
      ),
    ).toThrow(AllegroShipmentRejectedException);
  });
});

describe('mapShipmentStateToStatus', () => {
  it('maps a canceled shipment to cancelled', () => {
    const resource: AllegroShipmentResource = { id: 's1', canceledDate: '2026-05-26T10:00:00Z' };
    expect(mapShipmentStateToStatus(resource)).toBe('cancelled');
    expect(describeShipmentState(resource)).toBe('canceled');
  });

  it('maps a shipment with a carrier waybill to dispatched', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [{ transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6800000001' }] }],
    };
    expect(mapShipmentStateToStatus(resource)).toBe('dispatched');
    expect(describeShipmentState(resource)).toBe('waybill-assigned');
  });

  it('maps a freshly-created shipment (no waybill, not canceled) to generated', () => {
    const resource: AllegroShipmentResource = { id: 's1', packages: [{}] };
    expect(mapShipmentStateToStatus(resource)).toBe('generated');
    expect(describeShipmentState(resource)).toBe('created');
  });
});

describe('extractCarrierWaybill', () => {
  it('returns undefined when there are no packages', () => {
    expect(extractCarrierWaybill({ id: 's1' })).toBeUndefined();
  });

  it('returns undefined when no transportingInfo carries a waybill', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [{ transportingInfo: [{ carrierId: 'INPOST' }] }],
    };
    expect(extractCarrierWaybill(resource)).toBeUndefined();
  });

  it('returns the first non-empty carrierWaybill in document order', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [
        { transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6800000001' }] },
        { transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6800000002' }] },
      ],
    };
    expect(extractCarrierWaybill(resource)).toBe('6800000001');
  });

  it('skips empty-string waybills and returns the next non-empty value', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [
        { transportingInfo: [{ carrierWaybill: '' }, { carrierWaybill: '6800000003' }] },
      ],
    };
    expect(extractCarrierWaybill(resource)).toBe('6800000003');
  });
});

describe('toGenerateLabelResult', () => {
  it('returns an opaque label ref carrying the provider shipment id and null tracking', () => {
    expect(toGenerateLabelResult('allegro-ship-1')).toEqual({
      providerShipmentId: 'allegro-ship-1',
      trackingNumber: null,
      labelPdfRef: 'allegro-delivery:label:allegro-ship-1',
    });
  });
});

describe('formatCommandErrors', () => {
  it('prefers userMessage, falls back to message then code', () => {
    expect(
      formatCommandErrors([
        { userMessage: 'Sender zip outside service area' },
        { message: 'raw message' },
        { code: 'SOME_CODE' },
      ]),
    ).toBe('Sender zip outside service area; raw message; SOME_CODE');
  });

  it('returns a fallback when there is no error detail', () => {
    expect(formatCommandErrors(undefined)).toBe('Allegro returned no error detail');
    expect(formatCommandErrors([])).toBe('Allegro returned no error detail');
  });
});

describe('normalizeAllegroCarrierId (#769)', () => {
  it.each([
    ['INPOST', 'inpost'],
    ['DPD', 'dpd'],
    ['DHL', 'dhl'],
    ['ORLEN', 'orlen'],
    ['ORLEN_PACZKA', 'orlen'],
    ['ALLEGRO_ONE_BOX', 'allegro-one-box'],
    ['ALLEGRO_ONE_PUNKT', 'allegro-one-punkt'],
    ['ALLEGRO_ONE_KURIER', 'allegro-one-kurier'],
    ['POCZTA', 'poczta-polska'],
    ['POCZTA_POLSKA', 'poczta-polska'],
    ['UPS', 'ups'],
    ['PACKETA', 'packeta'],
  ])('should map %s to canonical %s', (raw, expected) => {
    expect(normalizeAllegroCarrierId(raw)).toBe(expected);
  });

  it('should lowercase-passthrough an unknown value (graceful FE degradation — copy-text only)', () => {
    expect(normalizeAllegroCarrierId('SHOPIFY_SHIPPING')).toBe('shopify_shipping');
  });

  it('should return undefined when input is undefined', () => {
    expect(normalizeAllegroCarrierId(undefined)).toBeUndefined();
  });
});

describe('extractCarrierId (#769)', () => {
  it('should return undefined when there are no packages', () => {
    expect(extractCarrierId({ id: 's1' })).toBeUndefined();
  });

  it('should return undefined when no transportingInfo carries a carrierId', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [{ transportingInfo: [{ carrierWaybill: '6800000001' }] }],
    };
    expect(extractCarrierId(resource)).toBeUndefined();
  });

  it('should return the canonical-form carrier from the first transportingInfo entry', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [{ transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6800000001' }] }],
    };
    expect(extractCarrierId(resource)).toBe('inpost');
  });

  it('should walk packages in document order and return the first found', () => {
    const resource: AllegroShipmentResource = {
      id: 's1',
      packages: [
        { transportingInfo: [{ carrierId: 'DPD', carrierWaybill: 'first' }] },
        { transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: 'second' }] },
      ],
    };
    expect(extractCarrierId(resource)).toBe('dpd');
  });
});
