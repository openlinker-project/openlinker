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
import { ShippingProviderRejectionException, type GenerateLabelCommand } from '@openlinker/core/shipping';
import type { DpdConnectionConfig } from '../../../domain/types/dpd-config.types';
import type { IDpdHttpClient } from '../../http/dpd-http-client.interface';
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
  let adapter: DpdShippingAdapter;

  beforeEach(() => {
    http = { request: jest.fn() };
    adapter = new DpdShippingAdapter(http, makeConfig());
  });

  it('should declare kurier as the only supported method', () => {
    expect(adapter.getSupportedMethods()).toEqual(['kurier']);
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
    // The create must NOT opt into network-retry (double-COD guard).
    expect(http.request).toHaveBeenCalledWith(
      expect.not.objectContaining({ retryOnNetworkError: true }),
    );
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
      expect.objectContaining({ method: 'POST', path: '/public/shipment/v1/generateSpedLabels', retryOnNetworkError: true }),
    );
  });

  it('should throw a typed tracking.unavailable rejection from getTracking', async () => {
    await expect(adapter.getTracking({ providerShipmentId: 'WB1' })).rejects.toMatchObject({
      providerName: 'dpd',
      providerCode: 'tracking.unavailable',
    });
  });
});
