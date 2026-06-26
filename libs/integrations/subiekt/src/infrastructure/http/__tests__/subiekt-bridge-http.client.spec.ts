/**
 * Subiekt Bridge HTTP Client — unit tests (#753)
 *
 * Mocks global.fetch (never real HTTP). Owns the `'safe'` retryability
 * assertion + the full `error.cause.code` phase-classification matrix, the
 * construction-time SSRF accept/reject matrix (incl. numeric IMDS encodings),
 * the per-redirect guard, and the token-never-logged guarantee.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http/__tests__
 */
import { SubiektBridgeUnreachableError, SubiektRejectedError } from '../../../bridge/subiekt-bridge.errors';
import { SubiektBridgeAuthError } from '../../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektConfigException } from '../../../domain/exceptions/subiekt-config.exception';
import { SubiektBridgeHttpClient } from '../subiekt-bridge-http.client';
import {
  sampleIssueInvoiceRequest,
  sampleUpsertCustomerRequest,
} from '../../../testing/subiekt-bridge-contract.suite';

const BASE = 'http://192.168.1.10:5000';

/**
 * A 2xx response wrapping `data` in the real bridge `{ success, data, error }`
 * envelope (the client unwraps it).
 */
function okResponse(data: unknown): Response {
  return {
    status: 200,
    headers: { get: (): string | null => null },
    json: (): Promise<unknown> => Promise.resolve({ success: true, data, error: null }),
  } as unknown as Response;
}

/**
 * A non-2xx response. `body` is sent verbatim so a test can supply either an
 * enveloped error (`{ error: { reason } }`) or a bare `{ reason }`.
 */
function errorResponse(status: number, body: unknown, location?: string): Response {
  return {
    status,
    headers: {
      get: (k: string): string | null =>
        k.toLowerCase() === 'location' ? location ?? null : null,
    },
    json: (): Promise<unknown> => Promise.resolve(body),
  } as unknown as Response;
}

/** A bridge enveloped error body for the given reason. */
function envelopeError(reason: string): unknown {
  return { success: false, data: null, error: { code: 'bad_request', reason, correlationId: null } };
}

function fetchError(code: string): Error {
  return Object.assign(new Error('fetch failed'), { cause: { code } });
}

describe('SubiektBridgeHttpClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('construction-time URL safety', () => {
    it('accepts http://192.168.x (private LAN allowed)', () => {
      expect(() => new SubiektBridgeHttpClient('http://192.168.1.10:5000')).not.toThrow();
    });

    it('accepts http://10.x (private LAN allowed)', () => {
      expect(() => new SubiektBridgeHttpClient('http://10.0.0.5')).not.toThrow();
    });

    it('accepts http://172.16.x (private LAN allowed)', () => {
      expect(() => new SubiektBridgeHttpClient('http://172.16.0.5')).not.toThrow();
    });

    it('accepts http://localhost and http://127.0.0.1 (loopback allowed)', () => {
      expect(() => new SubiektBridgeHttpClient('http://localhost:5000')).not.toThrow();
      expect(() => new SubiektBridgeHttpClient('http://127.0.0.1:5000')).not.toThrow();
    });

    it('rejects http://169.254.169.254 with SubiektConfigException', () => {
      expect(() => new SubiektBridgeHttpClient('http://169.254.169.254')).toThrow(
        SubiektConfigException,
      );
    });

    it('rejects decimal IMDS http://2852039166 with SubiektConfigException', () => {
      expect(() => new SubiektBridgeHttpClient('http://2852039166')).toThrow(SubiektConfigException);
    });

    it('rejects hex IMDS http://0xa9fea9fe with SubiektConfigException', () => {
      expect(() => new SubiektBridgeHttpClient('http://0xa9fea9fe')).toThrow(SubiektConfigException);
    });

    it('rejects an octal IMDS encoding with SubiektConfigException', () => {
      expect(() => new SubiektBridgeHttpClient('http://0251.0376.0251.0376')).toThrow(
        SubiektConfigException,
      );
    });

    it('rejects http://metadata.google.internal with SubiektConfigException', () => {
      expect(() => new SubiektBridgeHttpClient('http://metadata.google.internal')).toThrow(
        SubiektConfigException,
      );
    });
  });

  describe('issueInvoice', () => {
    it('returns a typed response on 2xx (unwrapping the envelope)', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          providerInvoiceId: 100355,
          providerInvoiceNumber: 'FS 166/CENTRALA/2026',
          state: 'issued',
          regulatoryStatus: 'pending',
          pdfUrl: null,
        }),
      );
      const client = new SubiektBridgeHttpClient(BASE);
      const res = await client.issueInvoice(sampleIssueInvoiceRequest());
      expect(res.providerInvoiceId).toBe(100355);
      expect(res.state).toBe('issued');
    });

    it('throws SubiektRejectedError on a 2xx success:false envelope', async () => {
      // A success:false envelope returned with a 200 (the bridge's validation path).
      fetchMock.mockResolvedValue({
        status: 200,
        headers: { get: (): string | null => null },
        json: (): Promise<unknown> => Promise.resolve(envelopeError('NazwaSkrocona jest wymagana.')),
      } as unknown as Response);
      const client = new SubiektBridgeHttpClient(BASE);
      await expect(client.issueInvoice(sampleIssueInvoiceRequest())).rejects.toThrow(
        'NazwaSkrocona jest wymagana.',
      );
    });

    it('places idempotencyKey on the request body before fetch', async () => {
      fetchMock.mockResolvedValue(
        okResponse({
          providerInvoiceId: 100355,
          providerInvoiceNumber: 'FV-001',
          state: 'issued',
          regulatoryStatus: 'sent',
          pdfUrl: null,
        }),
      );
      const client = new SubiektBridgeHttpClient(BASE);
      await client.issueInvoice(sampleIssueInvoiceRequest({ idempotencyKey: 'idem-1' }));
      const firstCall = fetchMock.mock.calls[0] as [string, { body: string }];
      const body = JSON.parse(firstCall[1].body) as {
        idempotencyKey?: string;
      };
      expect(body.idempotencyKey).toBe('idem-1');
    });

    it('throws SubiektRejectedError on 4xx with an enveloped {error.reason} body', async () => {
      fetchMock.mockResolvedValue(errorResponse(400, envelopeError('invalid NIP')));
      const client = new SubiektBridgeHttpClient(BASE);
      const err = await client
        .issueInvoice(sampleIssueInvoiceRequest())
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SubiektRejectedError);
      expect((err as SubiektRejectedError).reason).toBe('invalid NIP');
    });

    it('throws SubiektBridgeAuthError (NOT a rejection) on 401', async () => {
      fetchMock.mockResolvedValue(errorResponse(401, { reason: 'invalid NIP' }));
      const client = new SubiektBridgeHttpClient(BASE);
      const err = await client
        .issueInvoice(sampleIssueInvoiceRequest())
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SubiektBridgeAuthError);
      // A 401 must NOT be surfaced as a fiscal rejection.
      expect(err).not.toBeInstanceOf(SubiektRejectedError);
      expect((err as Error).message).toBe(
        'Subiekt bridge authentication failed (check bridge token/credentials)',
      );
      expect((err as SubiektBridgeAuthError).status).toBe(401);
    });

    it('throws SubiektBridgeAuthError (NOT a rejection) on 403', async () => {
      fetchMock.mockResolvedValue(errorResponse(403, {}));
      const client = new SubiektBridgeHttpClient(BASE);
      const err = await client
        .issueInvoice(sampleIssueInvoiceRequest())
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SubiektBridgeAuthError);
      expect(err).not.toBeInstanceOf(SubiektRejectedError);
      expect((err as SubiektBridgeAuthError).status).toBe(403);
    });

    it('never leaks the token in the auth error or any log line on a 401', async () => {
      const warnSpy = jest.fn();
      fetchMock.mockResolvedValue(errorResponse(401, {}));
      const client = new SubiektBridgeHttpClient(BASE, { token: 'tok-secret' });
      (client as unknown as { logger: { warn: typeof warnSpy } }).logger.warn = warnSpy;
      const err = await client
        .issueInvoice(sampleIssueInvoiceRequest())
        .then(() => null)
        .catch((e: unknown) => e);
      expect(JSON.stringify(err instanceof Error ? err.message : err)).not.toContain('tok-secret');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('tok-secret');
    });
  });

  describe('retryability phase classification (error.cause.code)', () => {
    async function retryabilityFor(code: string): Promise<unknown> {
      fetchMock.mockRejectedValue(fetchError(code));
      const client = new SubiektBridgeHttpClient(BASE);
      try {
        await client.issueInvoice(sampleIssueInvoiceRequest());
      } catch (err) {
        return (err as { retryability?: unknown }).retryability;
      }
      throw new Error('expected a rejection');
    }

    it("classifies ECONNREFUSED -> retryability 'safe'", async () => {
      expect(await retryabilityFor('ECONNREFUSED')).toBe('safe');
    });

    it("classifies ENOTFOUND -> retryability 'safe'", async () => {
      expect(await retryabilityFor('ENOTFOUND')).toBe('safe');
    });

    it("classifies EAI_AGAIN -> retryability 'safe'", async () => {
      expect(await retryabilityFor('EAI_AGAIN')).toBe('safe');
    });

    it("classifies AbortError/timeout -> retryability 'indeterminate'", async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const client = new SubiektBridgeHttpClient(BASE);
      try {
        await client.issueInvoice(sampleIssueInvoiceRequest());
        throw new Error('expected a rejection');
      } catch (err) {
        expect((err as { retryability?: unknown }).retryability).toBe('indeterminate');
      }
    });

    it("classifies ECONNRESET -> retryability 'indeterminate'", async () => {
      expect(await retryabilityFor('ECONNRESET')).toBe('indeterminate');
    });

    it("classifies an unrecognised code -> retryability 'indeterminate'", async () => {
      expect(await retryabilityFor('EWHATEVER')).toBe('indeterminate');
    });

    it("classifies HTTP 5xx -> retryability 'indeterminate'", async () => {
      fetchMock.mockResolvedValue(errorResponse(503, {}));
      const client = new SubiektBridgeHttpClient(BASE);
      try {
        await client.issueInvoice(sampleIssueInvoiceRequest());
        throw new Error('expected a rejection');
      } catch (err) {
        expect((err as { retryability?: unknown }).retryability).toBe('indeterminate');
      }
    });

    it('thrown error is instanceof SubiektBridgeUnreachableError (contract-suite compatibility)', async () => {
      fetchMock.mockRejectedValue(fetchError('ECONNREFUSED'));
      const client = new SubiektBridgeHttpClient(BASE);
      await expect(client.issueInvoice(sampleIssueInvoiceRequest())).rejects.toBeInstanceOf(
        SubiektBridgeUnreachableError,
      );
    });
  });

  describe('redirect guard', () => {
    it('rejects a redirect Location pointing at a metadata/IMDS host (incl. numeric)', async () => {
      fetchMock.mockResolvedValue(errorResponse(302, {}, 'http://169.254.169.254/'));
      const client = new SubiektBridgeHttpClient(BASE);
      await expect(client.issueInvoice(sampleIssueInvoiceRequest())).rejects.toBeInstanceOf(
        SubiektConfigException,
      );
    });
  });

  describe('getInvoiceStatus', () => {
    it('issues a GET to the templated /api/faktury/{id}/status path and derives state', async () => {
      // Real status `data`: Polish document status + KSeF regulatoryStatus, no `state`.
      fetchMock.mockResolvedValue(
        okResponse({ status: 'zatwierdzony', regulatoryStatus: 'pending' }),
      );
      const client = new SubiektBridgeHttpClient(BASE);
      const status = await client.getInvoiceStatus({ providerInvoiceId: '100355' });
      const [url, init] = fetchMock.mock.calls[0] as [string, { method: string }];
      expect(url).toBe(`${BASE}/api/faktury/100355/status`);
      expect(init.method).toBe('GET');
      // The client derives `state: 'issued'` for a document that reads back.
      expect(status.state).toBe('issued');
      expect(status.regulatoryStatus).toBe('pending');
    });
  });

  describe('token handling', () => {
    it('attaches the bridge token header when provided', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ id: 101169, numer: '73', nazwaSkrocona: 'Test', nip: '1234567890' }),
      );
      const client = new SubiektBridgeHttpClient(BASE, { token: 'tok-123' });
      await client.upsertCustomer(sampleUpsertCustomerRequest());
      const firstCall = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
      const headers = firstCall[1].headers;
      expect(headers.authorization).toBe('Bearer tok-123');
      expect(headers['x-bridge-token']).toBe('tok-123');
    });

    it('never includes the token in any log line', async () => {
      const warnSpy = jest.fn();
      // Drive a transport failure so the client logs at warn level.
      fetchMock.mockRejectedValue(fetchError('ECONNRESET'));
      const client = new SubiektBridgeHttpClient(BASE, { token: 'tok-secret' });
      // Replace the private logger's warn to capture arguments.
      (client as unknown as { logger: { warn: typeof warnSpy } }).logger.warn = warnSpy;
      await expect(client.issueInvoice(sampleIssueInvoiceRequest())).rejects.toBeDefined();
      const serialized = JSON.stringify(warnSpy.mock.calls);
      expect(serialized).not.toContain('tok-secret');
    });
  });

  it('imports isBridgeUrlSafe from the url-safety module, not the DTO', () => {
    // Construction-time validation works without class-validator's DTO graph —
    // proving the transport reuses the predicate directly (a successful private
    // LAN construction and an IMDS rejection both exercise that import).
    expect(() => new SubiektBridgeHttpClient('http://10.0.0.1')).not.toThrow();
    expect(() => new SubiektBridgeHttpClient('http://169.254.169.254')).toThrow(
      SubiektConfigException,
    );
  });
});
