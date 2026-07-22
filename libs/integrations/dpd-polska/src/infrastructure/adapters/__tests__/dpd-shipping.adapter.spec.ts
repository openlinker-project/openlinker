/**
 * DPD Shipping Adapter — unit tests
 *
 * Mocks `IDpdHttpClient` to verify the create/label orchestration: the
 * non-idempotent create path, COD wiring, the three-level body-status guard
 * (business failures arrive as HTTP 200), label decode, supported methods, and
 * the dormant `getTracking` throw.
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/adapters
 */
import {
  isDispatchProtocolReader,
  isPickupPointFinder,
  ShippingProviderRejectionException,
  type GenerateLabelCommand,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';
import type { DpdConnectionConfig } from '../../../domain/types/dpd-config.types';
import type { IDpdHttpClient } from '../../http/dpd-http-client.interface';
import type { IDpdInfoSoapClient } from '../../http/dpd-info-soap-client.interface';
import { DpdShippingAdapter } from '../dpd-shipping.adapter';

function makeConfig(): DpdConnectionConfig {
  return {
    environment: 'sandbox',
    payerFid: '1495',
    senderAddress: {
      name: 'Sklep ACME',
      address: 'Magazynowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      countryCode: 'PL',
    },
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
      address: { street: 'Krakowska', buildingNumber: '12', city: 'Poznań', postCode: '60-001', countryCode: 'PL' },
    },
    parcel: { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1500 },
    ...overrides,
  };
}

describe('DpdShippingAdapter', () => {
  let http: jest.Mocked<IDpdHttpClient>;
  let infoClient: jest.Mocked<IDpdInfoSoapClient>;
  let adapter: DpdShippingAdapter;

  beforeEach(() => {
    http = { request: jest.fn() };
    infoClient = { getEventsForWaybill: jest.fn() };
    adapter = new DpdShippingAdapter(http, makeConfig(), infoClient);
  });

  it('should declare kurier and pickup as supported methods', () => {
    expect(adapter.getSupportedMethods()).toEqual(['kurier', 'pickup']);
  });

  it('should declare the PickupPointFinder capability', () => {
    expect(isPickupPointFinder(adapter)).toBe(true);
  });

  it('should declare the DispatchProtocolReader capability', () => {
    expect(isDispatchProtocolReader(adapter)).toBe(true);
  });

  it('should generate a handover protocol PDF over a batch of waybills (idempotent)', async () => {
    const pdf = Buffer.from('%PDF-protocol', 'utf8').toString('base64');
    http.request.mockResolvedValueOnce({ status: 'OK', documentData: pdf });

    const doc = await adapter.generateProtocol({ providerShipmentIds: ['WB1', 'WB2'] });

    expect(doc.contentType).toBe('application/pdf');
    expect(Buffer.from(doc.body).toString('utf8')).toBe('%PDF-protocol');
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/public/shipment/v1/generateProtocol', idempotent: true }),
    );
    const body = http.request.mock.calls[0][0].body as {
      session: { type: string; packages: Array<{ parcels: Array<{ waybill: string }> }> };
    };
    expect(body.session.type).toBe('DOMESTIC');
    expect(body.session.packages.map((p) => p.parcels[0].waybill)).toEqual(['WB1', 'WB2']);
  });

  it('should reject when protocol generation returns a non-OK status', async () => {
    http.request.mockResolvedValueOnce({ status: 'PROTOCOL_ERROR' });
    await expect(
      adapter.generateProtocol({ providerShipmentIds: ['WB1'] }),
    ).rejects.toBeInstanceOf(ShippingProviderRejectionException);
  });

  it('should create a shipment and return the waybill as provider id + tracking + label ref', async () => {
    http.request.mockResolvedValueOnce({
      status: 'OK',
      packages: [{ status: 'OK', parcels: [{ status: 'OK', waybill: 'WB123' }] }],
    });

    const result = await adapter.generateLabel(makeCmd());

    expect(result).toEqual({ providerShipmentId: 'WB123', trackingNumber: 'WB123', labelPdfRef: 'WB123' });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/public/shipment/v1/generatePackagesNumbers' }),
    );
    // The create must NOT opt into idempotent retry (double-COD guard).
    expect(http.request).toHaveBeenCalledWith(expect.not.objectContaining({ idempotent: true }));
  });

  it('should thread COD into the create request body', async () => {
    http.request.mockResolvedValueOnce({
      status: 'OK',
      packages: [{ status: 'OK', parcels: [{ status: 'OK', waybill: 'WB1' }] }],
    });

    await adapter.generateLabel(makeCmd({ cod: { amount: '39.99', currency: 'PLN' } }));

    const body = http.request.mock.calls[0][0].body as { packages: Array<{ services?: unknown }> };
    expect(body.packages[0].services).toEqual([
      { code: 'COD', attributes: [{ code: 'AMOUNT', value: '39.99' }, { code: 'CURRENCY', value: 'PLN' }] },
    ]);
  });

  it('should reject when a business failure arrives as HTTP 200 with a non-OK parcel status', async () => {
    http.request.mockResolvedValueOnce({
      status: 'OK',
      packages: [
        {
          status: 'OK',
          parcels: [{ status: 'COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE', validationInfo: [{ errorCode: 'COD_IS_NOT_AVAILABLE_FOR_POSTAL_CODE' }] }],
        },
      ],
    });

    await expect(adapter.generateLabel(makeCmd())).rejects.toBeInstanceOf(ShippingProviderRejectionException);
  });

  it('should log the full raw DPD body keyed by traceId when a create is rejected', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    http.request.mockResolvedValueOnce({
      status: 'NOT_PROCESSED',
      traceId: 'trace-abc-123',
      packages: [{ status: 'NOT_PROCESSED', parcels: [] }],
    });

    await expect(adapter.generateLabel(makeCmd())).rejects.toBeInstanceOf(
      ShippingProviderRejectionException,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as string;
    expect(logged).toContain('trace-abc-123');
    expect(logged).toContain('NOT_PROCESSED');
    // The full raw body is logged verbatim so an errorCode-less rejection is diagnosable.
    expect(logged).toContain(JSON.stringify({ status: 'NOT_PROCESSED', traceId: 'trace-abc-123', packages: [{ status: 'NOT_PROCESSED', parcels: [] }] }));
    warn.mockRestore();
  });

  it('should surface DPD traceId on the rejection providerDetails for recovery', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    http.request.mockResolvedValueOnce({
      status: 'NOT_PROCESSED',
      traceId: 'trace-xyz-789',
      packages: [{ status: 'NOT_PROCESSED', parcels: [] }],
    });

    await expect(adapter.generateLabel(makeCmd())).rejects.toMatchObject({
      providerDetails: { traceId: 'trace-xyz-789' },
    });
  });

  it('should not fail when a rejected response carries no traceId', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    http.request.mockResolvedValueOnce({ status: 'PROTOCOL_ERROR' });

    await expect(
      adapter.generateProtocol({ providerShipmentIds: ['WB1'] }),
    ).rejects.toBeInstanceOf(ShippingProviderRejectionException);
  });

  it('should propagate an HTTP-level rejection from the client', async () => {
    http.request.mockRejectedValueOnce(
      new ShippingProviderRejectionException('dpd', 'INCORRECT_PAYER_FID', 'bad fid'),
    );

    await expect(adapter.generateLabel(makeCmd())).rejects.toMatchObject({ providerCode: 'INCORRECT_PAYER_FID' });
  });

  it('should render a label PDF for an existing waybill (idempotent, retry-enabled)', async () => {
    const pdf = Buffer.from('%PDF-1.4', 'utf8').toString('base64');
    http.request.mockResolvedValueOnce({ status: 'OK', documentData: pdf });

    const doc = await adapter.fetchLabel({ providerShipmentId: 'WB123' });

    expect(doc.contentType).toBe('application/pdf');
    expect(Buffer.from(doc.body).toString('utf8')).toBe('%PDF-1.4');
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/public/shipment/v1/generateSpedLabels', idempotent: true }),
    );
  });

  it('should read the waybill events via InfoServices and map them to a snapshot', async () => {
    infoClient.getEventsForWaybill.mockResolvedValueOnce([
      { businessCode: '040101', eventTime: '2026-06-10T09:00:00' },
      { businessCode: '190101', eventTime: '2026-06-11T14:30:00' },
    ]);

    const snapshot = await adapter.getTracking({ providerShipmentId: 'WB1' });

    expect(infoClient.getEventsForWaybill).toHaveBeenCalledWith({ waybill: 'WB1' });
    expect(snapshot.status).toBe('delivered');
    expect(snapshot.providerStatus).toBe('190101');
  });

  it('should propagate an InfoServices failure from getTracking', async () => {
    const boom = new Error('soap down');
    infoClient.getEventsForWaybill.mockRejectedValueOnce(boom);
    await expect(adapter.getTracking({ providerShipmentId: 'WB1' })).rejects.toBe(boom);
  });

  it('should create a pickup shipment to a DPD point (pudoReceiver + DPD_PICKUP)', async () => {
    http.request.mockResolvedValueOnce({
      status: 'OK',
      packages: [{ status: 'OK', parcels: [{ status: 'OK', waybill: 'WB-PUDO' }] }],
    });

    const result = await adapter.generateLabel(makeCmd({ shippingMethod: 'pickup', paczkomatId: 'PL11033' }));

    expect(result.providerShipmentId).toBe('WB-PUDO');
    const body = http.request.mock.calls[0][0].body as {
      packages: Array<{ pudoReceiver?: { pudoId: string }; receiver?: unknown; services?: Array<{ code: string }> }>;
    };
    expect(body.packages[0].pudoReceiver).toMatchObject({ pudoId: 'PL11033' });
    expect(body.packages[0].receiver).toBeUndefined();
    expect((body.packages[0].services ?? []).map((s) => s.code)).toContain('DPD_PICKUP');
  });

  it('should search the DPD point directory via findPickupPoints', async () => {
    http.request.mockResolvedValueOnce({
      status: 'OK',
      points: [
        { id: 'PL11033', name: 'Żabka', address: { street: 'Krakowska 12', city: 'Poznań', postalCode: '60-001', countryCode: 'PL' } },
      ],
    });

    const points = await adapter.findPickupPoints({ city: 'Poznań' });

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ providerId: 'PL11033', name: 'Żabka', status: 'active' });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/public/appservices/v1/findPoints', idempotent: true }),
    );
  });

  it('should return an empty list when the directory has no points', async () => {
    http.request.mockResolvedValueOnce({ status: 'OK' });
    await expect(adapter.findPickupPoints({ city: 'Nowhere' })).resolves.toEqual([]);
  });
});
