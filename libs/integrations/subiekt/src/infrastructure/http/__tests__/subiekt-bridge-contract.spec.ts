/**
 * Subiekt Bridge HTTP Client — shared contract spec (#753)
 *
 * Runs `runSubiektBridgeContractTests(() => new SubiektBridgeHttpClient(...))`
 * against a STATEFUL global.fetch mock that routes by method+path and remembers
 * the numeric providerInvoiceId minted by POST /invoices so the subsequent
 * GET /invoices/{id}/status returns that id. Unknown ids default-route to a
 * 404/{reason}. Mock bodies are shaped like the REAL bridge — wrapped in the
 * `{ success, data, error }` ResponseEnvelope and using the real `data` field
 * names (numeric ids, Polish status payload) — so this spec exercises the
 * client's envelope-unwrapping exactly as the live bridge would.
 *
 * FIDELITY CAVEAT: this spec proves client<->mock INTERNAL consistency only.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http/__tests__
 */
import { runSubiektBridgeContractTests } from '../../../testing/subiekt-bridge-contract.suite';
import { SubiektBridgeHttpClient } from '../subiekt-bridge-http.client';

const BASE = 'http://192.168.1.10:5000';

interface MintedInvoice {
  providerInvoiceId: number;
  providerInvoiceNumber: string;
  state: 'issued' | 'failed';
  regulatoryStatus: 'none' | 'pending' | 'sent' | 'accepted' | 'rejected';
  pdfUrl: string | null;
}

/**
 * Build a stateful fetch mock. POST /invoices mints and remembers a numeric id;
 * GET /invoices/{id}/status returns the remembered KSeF status (Polish `data`
 * payload, no `state` — the client derives it); POST /customers/upsert returns a
 * numeric customer id; unknown status ids 404 with an enveloped error. Every 2xx
 * body is wrapped in the real `{ success, data, error }` envelope.
 */
function buildStatefulFetch(): jest.Mock {
  const issued = new Map<string, MintedInvoice>();
  let counter = 0;

  /** Wrap a `data` payload in the bridge's success envelope. */
  const okEnvelope = (status: number, data: unknown): Promise<Response> =>
    Promise.resolve({
      status,
      headers: { get: (): string | null => null },
      json: (): Promise<unknown> => Promise.resolve({ success: true, data, error: null }),
    } as unknown as Response);

  /** A non-2xx response carrying the bridge's enveloped error. */
  const errorEnvelope = (status: number, reason: string): Promise<Response> =>
    Promise.resolve({
      status,
      headers: { get: (): string | null => null },
      json: (): Promise<unknown> =>
        Promise.resolve({
          success: false,
          data: null,
          error: { code: 'bad_request', reason, correlationId: null },
        }),
    } as unknown as Response);

  return jest.fn((url: string, init?: { method?: string }): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const path = url.slice(BASE.length);

    if (method === 'POST' && path === '/api/invoices') {
      counter += 1;
      const minted: MintedInvoice = {
        providerInvoiceId: 100_000 + counter,
        providerInvoiceNumber: `FV-${String(counter).padStart(3, '0')}`,
        state: 'issued',
        regulatoryStatus: 'sent',
        pdfUrl: null,
      };
      issued.set(String(minted.providerInvoiceId), minted);
      return okEnvelope(200, minted);
    }

    const correctionMatch = /^\/api\/invoices\/(\d+)\/corrections$/.exec(path);
    if (method === 'POST' && correctionMatch) {
      const origId = Number(correctionMatch[1]);
      counter += 1;
      const minted: MintedInvoice = {
        providerInvoiceId: 300_000 + counter,
        providerInvoiceNumber: `FK-${String(counter).padStart(3, '0')}`,
        state: 'issued',
        regulatoryStatus: 'sent',
        pdfUrl: null,
      };
      // Remember it (status-shaped) so a later status read-back resolves; the
      // korekta `data` payload itself carries NO regulatoryStatus / pdfUrl.
      issued.set(String(minted.providerInvoiceId), minted);
      return okEnvelope(200, {
        providerInvoiceId: minted.providerInvoiceId,
        providerInvoiceNumber: minted.providerInvoiceNumber,
        korygowanyId: origId,
        przyczyna: 'Zwrot towaru',
        state: 'issued',
      });
    }

    if (method === 'POST' && path === '/api/customers/upsert') {
      counter += 1;
      const id = 200_000 + counter;
      return okEnvelope(200, { id, numer: String(id), nazwaSkrocona: 'Test', nip: '1234567890' });
    }

    if (method === 'GET' && path.startsWith('/api/invoices/') && path.endsWith('/status')) {
      const id = decodeURIComponent(path.slice('/api/invoices/'.length, -'/status'.length));
      const known = issued.get(id);
      if (!known) {
        return errorEnvelope(404, 'unknown invoice id');
      }
      // Real status `data`: a Polish document status + KSeF regulatoryStatus, no `state`.
      return okEnvelope(200, { status: 'zatwierdzony', regulatoryStatus: known.regulatoryStatus });
    }

    return errorEnvelope(404, `no route for ${method} ${path}`);
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
      documentType: 'FV',
      currency: 'PLN',
      orderId: 'o1',
      buyer: {
        name: 'Acme',
        nip: '1234567890',
        isCompany: true,
        address: { ulica: 'x', kodPocztowy: '00-001', miejscowosc: 'W', countryCode: 'PL' },
      },
      lines: [{ ilosc: 1, cenaBrutto: 1, stawkaVAT: '23', name: 'Widget' }],
    });
    const issuedId = String(issued.providerInvoiceId);
    const status = await client.getInvoiceStatus({ providerInvoiceId: issuedId });
    expect(status.state).toBe('issued');
    const calls = fetchMock.mock.calls as Array<[string, { method?: string } | undefined]>;
    const statusCall = calls.find((c) => c[0].endsWith('/status'));
    expect(statusCall?.[0]).toContain(issuedId);
  });
});
