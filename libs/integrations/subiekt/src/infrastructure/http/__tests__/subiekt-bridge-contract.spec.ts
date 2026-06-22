/**
 * Subiekt Bridge HTTP Client — shared contract spec (#753)
 *
 * Runs `runSubiektBridgeContractTests(() => new SubiektBridgeHttpClient(...))`
 * against a STATEFUL global.fetch mock that routes by method+path and remembers
 * the providerInvoiceId minted by POST /invoices so the subsequent
 * GET /invoices/{id}/status returns that id as state:'issued'. Unknown ids
 * default-route to a 404/{reason} (deterministic non-issued), NOT silently
 * state:'failed'.
 *
 * FIDELITY CAVEAT: this spec proves client<->mock INTERNAL consistency only.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http/__tests__
 */
import { runSubiektBridgeContractTests } from '../../../testing/subiekt-bridge-contract.suite';
import { SubiektBridgeHttpClient } from '../subiekt-bridge-http.client';

const BASE = 'http://192.168.1.10:5000';

interface MintedInvoice {
  providerInvoiceId: string;
  providerInvoiceNumber: string;
  state: 'issued' | 'failed';
  regulatoryStatus: 'none' | 'pending' | 'sent' | 'accepted' | 'rejected';
  pdfUrl: string | null;
}

/**
 * Build a stateful fetch mock. POST /invoices mints and remembers an id; GET
 * /invoices/{id}/status returns the remembered state; POST /customers returns a
 * provider customer id; unknown status ids 404 with a {reason}.
 */
function buildStatefulFetch(): jest.Mock {
  const issued = new Map<string, MintedInvoice>();
  let counter = 0;

  const jsonResponse = (status: number, body: unknown): Promise<Response> =>
    Promise.resolve({
      status,
      headers: { get: (): string | null => null },
      json: (): Promise<unknown> => Promise.resolve(body),
    } as unknown as Response);

  return jest.fn((url: string, init?: { method?: string }): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const path = url.slice(BASE.length);

    if (method === 'POST' && path === '/api/invoices') {
      counter += 1;
      const minted: MintedInvoice = {
        providerInvoiceId: `SUB-${counter}`,
        providerInvoiceNumber: `FV-${String(counter).padStart(3, '0')}`,
        state: 'issued',
        regulatoryStatus: 'sent',
        pdfUrl: null,
      };
      issued.set(minted.providerInvoiceId, minted);
      return jsonResponse(201, minted);
    }

    if (method === 'POST' && path === '/api/customers/upsert') {
      return jsonResponse(200, { providerCustomerId: 'KH-1' });
    }

    if (method === 'GET' && path.startsWith('/api/invoices/') && path.endsWith('/status')) {
      const id = decodeURIComponent(path.slice('/api/invoices/'.length, -'/status'.length));
      const known = issued.get(id);
      if (!known) {
        return jsonResponse(404, { reason: 'unknown invoice id' });
      }
      return jsonResponse(200, { state: known.state, regulatoryStatus: known.regulatoryStatus });
    }

    return jsonResponse(404, { reason: `no route for ${method} ${path}` });
  });
}

describe('SubiektBridgeHttpClient — shared contract', () => {
  beforeEach(() => {
    global.fetch = buildStatefulFetch() as unknown as typeof fetch;
  });

  runSubiektBridgeContractTests(() => new SubiektBridgeHttpClient(BASE));

  it('GET status path carries the providerInvoiceId minted by POST /invoices', async () => {
    const fetchMock = buildStatefulFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new SubiektBridgeHttpClient(BASE);
    const issued = await client.issueInvoice({
      orderId: 'o1',
      documentType: 'faktura',
      currency: 'PLN',
      buyer: {
        name: 'Acme',
        nip: '1234567890',
        isCompany: true,
        address: { line1: 'x', line2: null, city: 'W', postalCode: '00-001', countryCode: 'PL' },
      },
      lines: [{ name: 'Widget', quantity: 1, unitPriceGross: 1, taxRate: '23' }],
    });
    const status = await client.getInvoiceStatus({ providerInvoiceId: issued.providerInvoiceId });
    expect(status.state).toBe('issued');
    const calls = fetchMock.mock.calls as Array<[string, { method?: string } | undefined]>;
    const statusCall = calls.find((c) => c[0].endsWith('/status'));
    expect(statusCall?.[0]).toContain(issued.providerInvoiceId);
  });
});
