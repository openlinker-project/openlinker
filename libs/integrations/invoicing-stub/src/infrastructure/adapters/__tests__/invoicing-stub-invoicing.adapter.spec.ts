/**
 * Invoicing-stub Invoicing Adapter — unit tests (#3006)
 *
 * Driven against a mocked `fetchImpl` (never real HTTP) - the point of the
 * unit test is the adapter's own contract (request shape, response mapping,
 * failure translation), not a network round-trip. The real-network,
 * real-latency behaviour is exercised on the perf lab stand and by
 * `stubs/invoicing/test.mjs` against the actual stub server.
 *
 * @module libs/integrations/invoicing-stub/src/infrastructure/adapters/__tests__
 */
import { BuyerProfile } from '@openlinker/core/invoicing';
import type { BuyerAddress, IssueInvoiceCommand, TaxIdentifier } from '@openlinker/core/invoicing';
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import { InvoicingStubInvoicingAdapter } from '../invoicing-stub-invoicing.adapter';

const ADDRESS: BuyerAddress = {
  line1: 'ul. Testowa 1',
  line2: null,
  city: 'Warszawa',
  postalCode: '00-001',
  countryIso2: 'PL',
};

function buyer(taxId: TaxIdentifier | null = null): BuyerProfile {
  return new BuyerProfile('Jan Testowy', taxId, ADDRESS, 'private');
}

function command(overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand {
  return {
    connectionId: 'conn-invoicing-stub',
    orderId: 'ol_order_1',
    buyer: buyer(),
    currency: 'PLN',
    lines: [{ name: 'Perf test line', quantity: 1, unitPriceGross: 10, taxRate: '0' }],
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

function fakeLogger(): LoggerPort {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('InvoicingStubInvoicingAdapter', () => {
  describe('issueInvoice', () => {
    it('should POST to {baseUrl}/invoices and map a successful response into an issued InvoiceRecord', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>().mockResolvedValue(
        jsonResponse(201, {
          id: 'stub-inv-1-abcd',
          number: 'STUB/1',
          status: 'issued',
          issuedAt: '2026-01-01T00:00:00.000Z',
        }),
      );
      const adapter = new InvoicingStubInvoicingAdapter(
        'conn-invoicing-stub',
        'http://invoicing-stub:19082',
        fetchImpl,
        fakeLogger(),
      );

      const result = await adapter.issueInvoice(command());

      expect(fetchImpl).toHaveBeenCalledWith(
        'http://invoicing-stub:19082/invoices',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result.record.status).toBe('issued');
      expect(result.record.providerInvoiceId).toBe('stub-inv-1-abcd');
      expect(result.record.providerInvoiceNumber).toBe('STUB/1');
      expect(result.record.connectionId).toBe('conn-invoicing-stub');
      expect(result.record.orderId).toBe('ol_order_1');
      expect(result.record.regulatoryStatus).toBe('not-applicable');
    });

    it('should throw when the stub answers a non-2xx status, so InvoiceService retries rather than silently issuing nothing', async () => {
      const fetchImpl = jest
        .fn<ReturnType<FetchLike>, Parameters<FetchLike>>()
        .mockResolvedValue(jsonResponse(500, { error: 'boom' }));
      const adapter = new InvoicingStubInvoicingAdapter(
        'conn-invoicing-stub',
        'http://invoicing-stub:19082',
        fetchImpl,
        fakeLogger(),
      );

      await expect(adapter.issueInvoice(command())).rejects.toThrow(/HTTP 500/);
    });
  });

  describe('getInvoice / upsertCustomer / getSupportedDocumentTypes', () => {
    it('should return null / a fixed customer id / [invoice] without making a network call', async () => {
      const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>();
      const adapter = new InvoicingStubInvoicingAdapter(
        'conn-invoicing-stub',
        'http://invoicing-stub:19082',
        fetchImpl,
        fakeLogger(),
      );

      await expect(adapter.getInvoice({ orderId: 'x' })).resolves.toBeNull();
      await expect(adapter.upsertCustomer({ connectionId: 'c', buyer: buyer() })).resolves.toEqual({
        providerCustomerId: 'invoicing-stub-customer',
      });
      expect(adapter.getSupportedDocumentTypes()).toEqual(['invoice']);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
