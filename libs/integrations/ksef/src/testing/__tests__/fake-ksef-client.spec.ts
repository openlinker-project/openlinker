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
import { KSEF_SESSION_CLOSED_ZERO_VALID } from '../../infrastructure/adapters/ksef-session.types';
import type { OnlineSessionStatusResponse } from '../../infrastructure/adapters/ksef-session.types';
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

  async function status(client: FakeKsefClient, sessionRef: string): Promise<number> {
    const res = await client.get<OnlineSessionStatusResponse>(`/sessions/online/${sessionRef}`);
    return res.data.status.code;
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

  it('should produce a 35-char KSeF number on acceptance and reuse it stably', async () => {
    const client = new FakeKsefClient({ inProgressPolls: 0, sellerNip: '1234567890' });
    const { sessionRef, invoiceRef } = await openSubmitClose(client);

    expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.ACCEPTED);

    const upo = await client.postExpectingBinary(
      `/sessions/online/${sessionRef}/invoices/${invoiceRef}/upo`,
    );
    const text = new TextDecoder().decode(upo.data);
    const ksefNumber = text.replace('%PDF-1.4 FAKE-UPO ', '');
    expect(ksefNumber).toHaveLength(35);
    expect(ksefNumber).toMatch(/^\d{10}-\d{8}-[0-9A-F]{6}-[0-9A-F]{5}-\d{2}$/);
    expect(ksefNumber.startsWith('1234567890-')).toBe(true);
  });

  it('should hold a submitted invoice in-progress for the configured number of polls', async () => {
    const client = new FakeKsefClient({ inProgressPolls: 3 });
    const { sessionRef } = await openSubmitClose(client);

    expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.RECEIVED);
    expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.IN_PROGRESS);
    expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.IN_PROGRESS);
    expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.ACCEPTED);
  });

  describe('seeded failure modes', () => {
    it('should surface 445 via seedStatus and never advance to accepted', async () => {
      const client = new FakeKsefClient();
      client.seedStatus(KSEF_SESSION_CLOSED_ZERO_VALID);
      const { sessionRef } = await openSubmitClose(client);

      expect(await status(client, sessionRef)).toBe(KSEF_SESSION_CLOSED_ZERO_VALID);
      expect(await status(client, sessionRef)).toBe(KSEF_SESSION_CLOSED_ZERO_VALID);
    });

    it('should surface 210 (expired) as a sticky terminal status', async () => {
      const client = new FakeKsefClient();
      client.seedStatus(FAKE_KSEF_STATUS.EXPIRED);
      const { sessionRef } = await openSubmitClose(client);

      expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.EXPIRED);
    });

    it('should surface 410 (rejected) via seedRejection', async () => {
      const client = new FakeKsefClient();
      client.seedRejection();
      const { sessionRef } = await openSubmitClose(client);

      expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.REJECTED);
    });

    it('should never expose a UPO for a rejected session', async () => {
      const client = new FakeKsefClient();
      client.seedRejection();
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      await status(client, sessionRef);

      await expect(
        client.postExpectingBinary(`/sessions/online/${sessionRef}/invoices/${invoiceRef}/upo`),
      ).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should emit a transient 5xx the seeded number of times then recover', async () => {
      const client = new FakeKsefClient({ inProgressPolls: 0 });
      client.seedTransient(503, 2);
      const { sessionRef } = await openSubmitClose(client);

      await expect(status(client, sessionRef)).rejects.toBeInstanceOf(KsefApiException);
      await expect(status(client, sessionRef)).rejects.toBeInstanceOf(KsefApiException);
      // Third read recovers and the normal lifecycle resumes.
      expect(await status(client, sessionRef)).toBe(FAKE_KSEF_STATUS.ACCEPTED);
    });
  });

  describe('routing', () => {
    it('should 404 an unknown GET path', async () => {
      const client = new FakeKsefClient();
      await expect(client.get('/unknown/path')).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should 404 a status read for an unknown session', async () => {
      const client = new FakeKsefClient();
      await expect(status(client, 'NOPE')).rejects.toBeInstanceOf(KsefApiException);
    });

    it('should resolve invoice-keyed status reads to the owning session', async () => {
      const client = new FakeKsefClient({ inProgressPolls: 0 });
      const { invoiceRef } = await openSubmitClose(client);
      const res = await client.get<OnlineSessionStatusResponse>(`/invoices/${invoiceRef}`);
      expect(res.data.status.code).toBe(FAKE_KSEF_STATUS.ACCEPTED);
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
