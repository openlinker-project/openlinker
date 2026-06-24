/**
 * FakeKsefClient specs (#1153 / C9)
 *
 * Runs the shared `runKsefHttpClientContract` suite against the in-memory fake
 * (no network) and covers each seeded failure mode plus the deterministic
 * KSeF-number / UPO derivation. The real `KsefHttpClient` runs the SAME contract
 * behind an env-gate (see `ksef-client-contract.suite.ts` header) so fake and
 * real can't drift.
 *
 * @module libs/integrations/ksef/src/testing
 */
import { FakeKsefClient, FAKE_KSEF_STATUS } from '../fake-ksef-client';
import { runKsefHttpClientContract } from '../ksef-client-contract.suite';
import { KSEF_NUMBER_PATTERN } from '../../infrastructure/adapters/ksef-session.types';
import type {
  OnlineSessionStatusResponse,
  InvoiceStatusResponse,
} from '../../infrastructure/adapters/ksef-session.types';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';

// Shared behavioural contract — the fake honours every assertion, including the
// seeded terminal-failure + transient-5xx cases.
runKsefHttpClientContract(() => new FakeKsefClient({ inProgressPolls: 2 }), {
  supportsSeededFailures: true,
});

describe('FakeKsefClient', () => {
  async function openSubmitClose(
    client: FakeKsefClient,
  ): Promise<{ sessionRef: string; invoiceRef: string }> {
    const open = await client.post<{ referenceNumber: string }>('/sessions/online', {});
    const sessionRef = open.data.referenceNumber;
    const submit = await client.post<{ referenceNumber: string }>(
      `/sessions/online/${sessionRef}/invoices`,
      {},
    );
    const invoiceRef = submit.data.referenceNumber;
    await client.post(`/sessions/online/${sessionRef}/close`, undefined, { idempotent: true });
    return { sessionRef, invoiceRef };
  }

  /** Session status read at the reconciled session-scoped path. */
  async function sessionStatus(
    client: FakeKsefClient,
    sessionRef: string,
  ): Promise<OnlineSessionStatusResponse> {
    const res = await client.get<OnlineSessionStatusResponse>(`/sessions/${sessionRef}`);
    return res.data;
  }

  async function statusCode(client: FakeKsefClient, sessionRef: string): Promise<number> {
    return (await sessionStatus(client, sessionRef)).status.code;
  }

  it('should issue deterministic session/invoice references from a seeded counter', async () => {
    const client = new FakeKsefClient();
    const a = await openSubmitClose(client);
    const b = await openSubmitClose(client);

    expect(a.sessionRef).toBe('SESSION-000001');
    expect(a.invoiceRef).toBe('INVOICE-000002');
    expect(b.sessionRef).toBe('SESSION-000003');
    expect(b.invoiceRef).toBe('INVOICE-000004');
  });

  it('should produce a KSeF number matching the authoritative pattern on the per-invoice status', async () => {
    const client = new FakeKsefClient({ inProgressPolls: 0, sellerNip: '5265877635' });
    const { sessionRef, invoiceRef } = await openSubmitClose(client);

    // One poll flips the session to Success and stamps the KSeF number.
    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.SUCCESS);

    const res = await client.get<InvoiceStatusResponse>(
      `/sessions/${sessionRef}/invoices/${invoiceRef}`,
    );
    expect(res.data.status.code).toBe(FAKE_KSEF_STATUS.SUCCESS);
    const ksefNumber = res.data.ksefNumber ?? '';
    expect(ksefNumber).toHaveLength(35);
    expect(ksefNumber).toMatch(KSEF_NUMBER_PATTERN);
    expect(ksefNumber.startsWith('5265877635-')).toBe(true);
    // Flat UPO pointer rides on the success payload.
    expect(typeof res.data.upoDownloadUrl).toBe('string');
  });

  it('should serve the UPO pointer at the session-scoped path once accepted', async () => {
    const client = new FakeKsefClient({ inProgressPolls: 0 });
    const { sessionRef, invoiceRef } = await openSubmitClose(client);
    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.SUCCESS);

    const upo = await client.get<{ upoDownloadUrl?: string }>(
      `/sessions/${sessionRef}/invoices/${invoiceRef}/upo`,
    );
    expect(upo.status).toBe(200);
    expect((upo.data.upoDownloadUrl ?? '').length).toBeGreaterThan(0);
  });

  it('should hold a submitted invoice in-progress for the configured number of polls', async () => {
    const client = new FakeKsefClient({ inProgressPolls: 3 });
    const { sessionRef } = await openSubmitClose(client);

    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.PROCESSING_STARTED);
    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.IN_PROGRESS);
    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.IN_PROGRESS);
    expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.SUCCESS);
  });

  describe('seeded failure modes', () => {
    it('should model a processed-but-zero-valid session via forceZeroValid (count-based)', async () => {
      const client = new FakeKsefClient({ inProgressPolls: 0 });
      client.forceZeroValid();
      const { sessionRef } = await openSubmitClose(client);

      const settled = await sessionStatus(client, sessionRef);
      expect(settled.status.code).toBe(FAKE_KSEF_STATUS.SUCCESS);
      expect(settled.invoiceCount).toBe(1);
      expect(settled.successfulInvoiceCount).toBe(0);
      expect(settled.failedInvoiceCount).toBe(1);
      // Sticky: re-read still reports zero successful.
      expect((await sessionStatus(client, sessionRef)).successfulInvoiceCount).toBe(0);
    });

    it('should surface 400 (rejected) via seedRejection on both status reads', async () => {
      const client = new FakeKsefClient();
      client.seedRejection();
      const { sessionRef, invoiceRef } = await openSubmitClose(client);

      expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.REJECTED);
      const inv = await client.get<InvoiceStatusResponse>(
        `/sessions/${sessionRef}/invoices/${invoiceRef}`,
      );
      expect(inv.data.status.code).toBe(FAKE_KSEF_STATUS.REJECTED);
    });

    it('should surface 400 (rejected) via seedStatus', async () => {
      const client = new FakeKsefClient();
      client.seedStatus(FAKE_KSEF_STATUS.REJECTED);
      const { sessionRef } = await openSubmitClose(client);

      expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.REJECTED);
    });

    it('should reject seedStatus for an unsupported code', () => {
      const client = new FakeKsefClient();
      expect(() => client.seedStatus(999)).toThrow();
    });

    it('should never expose a UPO for a rejected session', async () => {
      const client = new FakeKsefClient();
      client.seedRejection();
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      await statusCode(client, sessionRef);

      await expect(
        client.get(`/sessions/${sessionRef}/invoices/${invoiceRef}/upo`),
      ).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should emit a transient 5xx the seeded number of times then recover', async () => {
      const client = new FakeKsefClient({ inProgressPolls: 0 });
      client.seedTransient(503, 2);
      const { sessionRef } = await openSubmitClose(client);

      await expect(statusCode(client, sessionRef)).rejects.toBeInstanceOf(KsefApiException);
      await expect(statusCode(client, sessionRef)).rejects.toBeInstanceOf(KsefApiException);
      // Third read recovers and the normal lifecycle resumes.
      expect(await statusCode(client, sessionRef)).toBe(FAKE_KSEF_STATUS.SUCCESS);
    });
  });

  describe('routing', () => {
    it('should 404 an unknown GET path', async () => {
      const client = new FakeKsefClient();
      await expect(client.get('/unknown/path')).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should 404 a session status read for an unknown session', async () => {
      const client = new FakeKsefClient();
      await expect(statusCode(client, 'NOPE')).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should serve per-invoice status reads at the session-scoped path', async () => {
      const client = new FakeKsefClient({ inProgressPolls: 0 });
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      const res = await client.get<InvoiceStatusResponse>(
        `/sessions/${sessionRef}/invoices/${invoiceRef}`,
      );
      expect(res.data.status.code).toBe(FAKE_KSEF_STATUS.SUCCESS);
    });
  });

  it('should reset all state on clear()', async () => {
    const client = new FakeKsefClient();
    await openSubmitClose(client);
    expect(client.calls.length).toBeGreaterThan(0);

    client.clear();
    expect(client.calls).toHaveLength(0);

    const open = await client.post<{ referenceNumber: string }>('/sessions/online', {});
    expect(open.data.referenceNumber).toBe('SESSION-000001');
  });
});
