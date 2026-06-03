/**
 * DPD Shipment Mapper — unit tests
 *
 * Pure-function coverage: request building (field flatten, grams→kg, mm→cm,
 * COD attributes, payerFID parse), the three-level body-status assertion, and
 * base64 label decode.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/mappers
 */
import type { GenerateLabelCommand } from '@openlinker/core/shipping';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type { DpdConnectionConfig } from '../../../domain/types/dpd-config.types';
import type {
  DpdGeneratePackagesNumbersResponse,
  DpdGenerateSpedLabelsResponse,
} from '../../../domain/types/dpd-rest.types';
import type { DpdPoint } from '../../../domain/types/dpd-rest.types';
import {
  assertCreateSucceededAndExtractWaybill,
  buildCreatePackagesRequest,
  buildGenerateLabelRequest,
  buildPointSearchQuery,
  decodeLabelDocument,
  toGenerateLabelResult,
  toPickupPoint,
} from '../dpd-shipment.mapper';

function makeConfig(overrides: Partial<DpdConnectionConfig> = {}): DpdConnectionConfig {
  return {
    environment: 'sandbox',
    payerFid: '1495',
    senderAddress: {
      name: 'Sklep ACME',
      address: 'Magazynowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      countryCode: 'PL',
      phone: '+48111222333',
      email: 'sklep@example.com',
    },
    ...overrides,
  };
}

function makeCmd(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
  return {
    shipmentId: 'ol_shipment_1',
    orderId: 'ol_order_1',
    connectionId: 'conn-dpd',
    shippingMethod: 'kurier',
    recipient: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      email: 'buyer@example.com',
      phone: '+48500600700',
      address: {
        street: 'Krakowska',
        buildingNumber: '12',
        city: 'Poznań',
        postCode: '60-001',
        countryCode: 'PL',
      },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1500 },
    ...overrides,
  };
}

function okCreateResponse(waybill = 'WB123'): DpdGeneratePackagesNumbersResponse {
  return {
    status: 'OK',
    sessionId: 1,
    packages: [{ status: 'OK', parcels: [{ status: 'OK', waybill }] }],
  };
}

describe('buildCreatePackagesRequest', () => {
  it('should build a single-package, single-parcel courier request with the sender from config', () => {
    const req = buildCreatePackagesRequest(makeCmd(), makeConfig());

    expect(req.generationPolicy).toBe('ALL_OR_NOTHING');
    expect(req.packages).toHaveLength(1);
    const pkg = req.packages[0];
    expect(pkg.reference).toBe('ol_shipment_1');
    expect(pkg.ref1).toBe('ol_order_1');
    expect(pkg.payerFID).toBe(1495); // numeric, parsed from the '1495' string
    expect(pkg.sender).toMatchObject({ name: 'Sklep ACME', address: 'Magazynowa 1', city: 'Warszawa' });
    expect(pkg.services).toBeUndefined();
    // Courier ships to a street receiver — never a pudoReceiver (mutual exclusivity).
    expect(pkg.pudoReceiver).toBeUndefined();
    expect(pkg.receiver).toBeDefined();
    expect(pkg.parcels).toHaveLength(1);
  });

  it('should flatten the split recipient address and name into DPD single fields', () => {
    const req = buildCreatePackagesRequest(makeCmd(), makeConfig());
    const receiver = req.packages[0].receiver;

    expect(receiver).toMatchObject({
      name: 'Jan Kowalski', // firstName + lastName
      address: 'Krakowska 12', // street + buildingNumber
      city: 'Poznań',
      postalCode: '60-001',
      countryCode: 'PL',
    });
  });

  it('should prefer recipient.name over first/last when present', () => {
    const req = buildCreatePackagesRequest(
      makeCmd({
        recipient: {
          name: 'ACME Sp. z o.o.',
          firstName: 'Jan',
          lastName: 'Kowalski',
          email: 'b@example.com',
          phone: '+48500600700',
          address: {
            street: 'Krakowska',
            buildingNumber: '12',
            city: 'Poznań',
            postCode: '60-001',
            countryCode: 'PL',
          },
        },
      }),
      makeConfig(),
    );

    expect(req.packages[0].receiver?.name).toBe('ACME Sp. z o.o.');
  });

  it('should omit the receiver name when the order carries no name parts', () => {
    const req = buildCreatePackagesRequest(
      makeCmd({
        recipient: {
          email: 'b@example.com',
          phone: '+48500600700',
          address: {
            street: 'Krakowska',
            buildingNumber: '12',
            city: 'Poznań',
            postCode: '60-001',
            countryCode: 'PL',
          },
        },
      }),
      makeConfig(),
    );

    expect(req.packages[0].receiver?.name).toBeUndefined();
  });

  it('should convert grams to kilograms and millimetres to centimetres', () => {
    const req = buildCreatePackagesRequest(makeCmd(), makeConfig());
    const parcel = req.packages[0].parcels[0];

    expect(parcel.weight).toBe(1.5); // 1500 g → 1.5 kg
    expect(parcel.sizeX).toBe(20); // 200 mm → 20 cm
    expect(parcel.sizeY).toBe(15);
    expect(parcel.sizeZ).toBe(10);
  });

  it('should emit a COD TransportService with AMOUNT and CURRENCY attributes', () => {
    const req = buildCreatePackagesRequest(
      makeCmd({ cod: { amount: '39.99', currency: 'PLN' } }),
      makeConfig(),
    );

    expect(req.packages[0].services).toEqual([
      {
        code: 'COD',
        attributes: [
          { code: 'AMOUNT', value: '39.99' },
          { code: 'CURRENCY', value: 'PLN' },
        ],
      },
    ]);
  });

  it('should reject a COD currency outside the DPD allow-list', () => {
    expect(() =>
      buildCreatePackagesRequest(makeCmd({ cod: { amount: '10.00', currency: 'USD' } }), makeConfig()),
    ).toThrow(ShippingProviderRejectionException);
  });

  it('should reject an unsupported shipping method', () => {
    expect(() => buildCreatePackagesRequest(makeCmd({ shippingMethod: 'omp' }), makeConfig())).toThrow(
      /'kurier' and 'pickup' only/,
    );
  });

  it('should reject a courier shipment with no recipient address', () => {
    const cmd = makeCmd();
    const noAddr = { ...cmd, recipient: { ...cmd.recipient, address: undefined } };
    expect(() => buildCreatePackagesRequest(noAddr, makeConfig())).toThrow(/recipient.address is required/);
  });

  it('should reject a courier shipment with no weight', () => {
    expect(() => buildCreatePackagesRequest(makeCmd({ parcel: {} }), makeConfig())).toThrow(
      /weightGrams is required/,
    );
  });
});

describe('buildCreatePackagesRequest — DPD Pickup (#963)', () => {
  function makePickupCmd(overrides: Partial<GenerateLabelCommand> = {}): GenerateLabelCommand {
    return makeCmd({ shippingMethod: 'pickup', paczkomatId: 'PL11033', ...overrides });
  }

  it('should build a pudoReceiver + DPD_PICKUP service for a pickup shipment (no courier receiver)', () => {
    const req = buildCreatePackagesRequest(makePickupCmd(), makeConfig());
    const pkg = req.packages[0];

    expect(pkg.receiver).toBeUndefined();
    expect(pkg.pudoReceiver).toMatchObject({
      pudoId: 'PL11033',
      name: 'Jan Kowalski',
      phone: '+48500600700',
      email: 'buyer@example.com',
    });
    expect(pkg.services).toEqual([{ code: 'DPD_PICKUP' }]);
    // Still a real parcel with weight.
    expect(pkg.parcels[0].weight).toBe(1.5);
  });

  it('should reject a pickup shipment with no point id (paczkomatId)', () => {
    const cmd = makePickupCmd({ paczkomatId: undefined });
    const error = run(() => buildCreatePackagesRequest(cmd, makeConfig()));
    expect(error).toMatchObject({ providerCode: 'preflight.missing-paczkomat-id' });
  });

  it('should NOT require a recipient street address for a pickup shipment', () => {
    const cmd = makePickupCmd();
    const noAddr = { ...cmd, recipient: { ...cmd.recipient, address: undefined } };
    expect(() => buildCreatePackagesRequest(noAddr, makeConfig())).not.toThrow();
  });

  it('should still attach COD on a pickup shipment (DPD_PICKUP + COD)', () => {
    const req = buildCreatePackagesRequest(
      makePickupCmd({ cod: { amount: '39.99', currency: 'PLN' } }),
      makeConfig(),
    );
    const codes = (req.packages[0].services ?? []).map((s) => s.code);
    expect(codes).toEqual(['DPD_PICKUP', 'COD']);
  });

  it('should reject an unsupported method with a kurier/pickup message', () => {
    expect(() => buildCreatePackagesRequest(makeCmd({ shippingMethod: 'omp' }), makeConfig())).toThrow(
      /'kurier' and 'pickup' only/,
    );
  });
});

describe('point directory mapping (#963)', () => {
  it('should map a neutral query to the DPD point-search shape', () => {
    expect(
      buildPointSearchQuery({ city: 'Poznań', postalCode: '60-001', searchText: 'Krakowska', limit: 20 }),
    ).toEqual({ city: 'Poznań', postalCode: '60-001', searchText: 'Krakowska', limit: 20 });
  });

  it('should map a DPD point to the neutral PickupPoint', () => {
    const point: DpdPoint = {
      id: 'PL11033',
      name: 'DPD Pickup Żabka',
      address: { street: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', countryCode: 'PL' },
      latitude: 52.4,
      longitude: 16.9,
      type: 'shop',
    };

    expect(toPickupPoint(point)).toEqual({
      providerId: 'PL11033',
      name: 'DPD Pickup Żabka',
      address: { line1: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', country: 'PL' },
      status: 'active',
      lat: 52.4,
      lon: 16.9,
    });
  });

  it('should fall back to the point id for the name and PL for the country when absent', () => {
    const point: DpdPoint = { id: 'PL999' };
    const mapped = toPickupPoint(point);
    expect(mapped.name).toBe('PL999');
    expect(mapped.address.country).toBe('PL');
  });
});

describe('assertCreateSucceededAndExtractWaybill', () => {
  it('should return the parcel waybill when every status level is OK', () => {
    expect(assertCreateSucceededAndExtractWaybill(okCreateResponse('WB999'))).toBe('WB999');
  });

  it('should throw with the validation errorCode when the top-level status is not OK', () => {
    const res: DpdGeneratePackagesNumbersResponse = {
      status: 'INCORRECT_DATA',
      packages: [
        {
          status: 'INCORRECT_DATA',
          parcels: [{ status: 'INCORRECT_DATA', validationInfo: [{ errorCode: 'INCORRECT_PAYER_FID', info: 'bad fid' }] }],
        },
      ],
    };

    const error = run(() => assertCreateSucceededAndExtractWaybill(res));
    expect(error).toBeInstanceOf(ShippingProviderRejectionException);
    expect(error).toMatchObject({ providerName: 'dpd', providerCode: 'INCORRECT_PAYER_FID' });
  });

  it('should throw when the package status is not OK even if the top status is OK', () => {
    const res: DpdGeneratePackagesNumbersResponse = {
      status: 'OK',
      packages: [{ status: 'INCORRECT_DATA', parcels: [{ status: 'OK', waybill: 'WB1' }] }],
    };
    expect(() => assertCreateSucceededAndExtractWaybill(res)).toThrow(ShippingProviderRejectionException);
  });

  it('should throw when the parcel status is not OK', () => {
    const res: DpdGeneratePackagesNumbersResponse = {
      status: 'OK',
      packages: [
        {
          status: 'OK',
          parcels: [{ status: 'COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE', validationInfo: [{ errorCode: 'COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE' }] }],
        },
      ],
    };
    const error = run(() => assertCreateSucceededAndExtractWaybill(res));
    expect(error).toMatchObject({ providerCode: 'COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE' });
  });

  it('should throw command.success-without-shipment-id when OK but no waybill', () => {
    const res: DpdGeneratePackagesNumbersResponse = {
      status: 'OK',
      packages: [{ status: 'OK', parcels: [{ status: 'OK' }] }],
    };
    const error = run(() => assertCreateSucceededAndExtractWaybill(res));
    expect(error).toMatchObject({ providerCode: 'command.success-without-shipment-id' });
  });
});

describe('toGenerateLabelResult', () => {
  it('should map the waybill to provider id, tracking number and label ref', () => {
    expect(toGenerateLabelResult('WB1')).toEqual({
      providerShipmentId: 'WB1',
      trackingNumber: 'WB1',
      labelPdfRef: 'WB1',
    });
  });
});

describe('buildGenerateLabelRequest', () => {
  it('should build a domestic PDF/A4/BIC3 request for the waybill', () => {
    expect(buildGenerateLabelRequest('WB1')).toEqual({
      labelSearchParams: {
        policy: 'STOP_ON_FIRST_ERROR',
        session: { type: 'DOMESTIC', packages: [{ parcels: [{ waybill: 'WB1' }] }] },
      },
      outputDocFormat: 'PDF',
      format: 'A4',
      outputType: 'BIC3',
    });
  });
});

describe('decodeLabelDocument', () => {
  it('should decode the base64 documentData to PDF bytes', () => {
    const pdf = Buffer.from('%PDF-1.4', 'utf8').toString('base64');
    const res: DpdGenerateSpedLabelsResponse = { status: 'OK', documentData: pdf };

    const doc = decodeLabelDocument(res);

    expect(doc.contentType).toBe('application/pdf');
    expect(Buffer.from(doc.body).toString('utf8')).toBe('%PDF-1.4');
  });

  it('should throw when the label status is not OK', () => {
    expect(() => decodeLabelDocument({ status: 'NOT_FOUND' })).toThrow(ShippingProviderRejectionException);
  });

  it('should throw command.empty-label when OK but no documentData', () => {
    const error = run(() => decodeLabelDocument({ status: 'OK' }));
    expect(error).toMatchObject({ providerCode: 'command.empty-label' });
  });
});

/** Run a throwing fn and return the thrown error (or null if it didn't throw). */
function run(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}
