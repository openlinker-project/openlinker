/**
 * KSeF HTTP Client Contract Suite (#1153 / C9)
 *
 * A shared, transport-level behavioural contract that BOTH the in-memory
 * `FakeKsefClient` and the real `KsefHttpClient` must satisfy, so the fake used
 * across core's invoicing integration tests can't silently drift from the wire
 * behaviour C5/C6 depend on. The suite exercises the online-session document
 * flow through the `IKsefHttpClient` surface (`get` / `post`) and asserts:
 *
 *   1. STATUS TRANSITION — a freshly-submitted invoice reads in-progress
 *      (100/150) on early polls then `200` (Success) on a later poll; the
 *      sequence is monotonic (never regresses from success back to in-progress).
 *   2. UPO AVAILABILITY — the UPO pointer (`GET …/upo` → `{ upoDownloadUrl }`)
 *      is fetchable ONLY after acceptance; a pre-acceptance fetch fails.
 *   3. TERMINAL FAILURES — a processed-but-zero-valid session reads `200` on the
 *      session status with `successfulInvoiceCount === 0`, and a per-invoice
 *      rejection reads `400` (consistent with the C6 clearance-status mapper).
 *   4. 5xx CLASSIFICATION — a transient `5xx` on an idempotent read either
 *      recovers (the client retried) or surfaces as a thrown transport error —
 *      never a silent success.
 *
 * ROUTES (reconciled #1147–#1151): open/send/close stay under `/sessions/online`;
 * session status is `GET /sessions/{ref}`, per-invoice status is
 * `GET /sessions/{ref}/invoices/{invoiceRef}`, and the UPO pointer is
 * `GET /sessions/{ref}/invoices/{invoiceRef}/upo`.
 *
 * USAGE — fake (no network):
 * ```ts
 * import { runKsefHttpClientContract } from '@openlinker/integrations-ksef/testing';
 * runKsefHttpClientContract(() => new FakeKsefClient(), { supportsSeededFailures: true });
 * ```
 *
 * USAGE — real client (env-gated): the real `KsefHttpClient` runs the SAME suite
 * behind a credentials gate so the two views can't diverge. A thin
 * `ksef-client-contract.real.int-spec.ts` (C-level follow-up) constructs the real
 * client from `process.env.KSEF_TEST_*` and calls this runner with
 * `{ supportsSeededFailures: false }`; when the env vars are absent the spec
 * `describe.skip`s itself so CI without sandbox creds stays green. The fake-side
 * spec (`fake-ksef-client.spec.ts`) always runs (no network), guaranteeing the
 * contract is enforced on every `pnpm test`; the real side enforces it whenever
 * sandbox creds are present.
 *
 * @module libs/integrations/ksef/src/testing
 * @see {@link FakeKsefClient}
 * @see {@link IKsefHttpClient}
 */
import type { IKsefHttpClient } from '../infrastructure/http/ksef-http-client.interface';
import type {
  OnlineSessionStatusResponse,
  InvoiceStatusResponse,
} from '../infrastructure/adapters/ksef-session.types';
import { FAKE_KSEF_STATUS } from './fake-ksef-client';

/** A seedable client exposes the failure-mode helpers the fake provides. */
interface SeedableKsefClient extends IKsefHttpClient {
  forceZeroValid(): unknown;
  seedStatus(code: number): unknown;
  seedTransient(status?: number, times?: number): unknown;
  clear?(): void;
}

export interface KsefClientContractOptions {
  /**
   * When true the runner casts the client to `SeedableKsefClient` and exercises
   * the terminal-failure + transient-5xx cases by seeding them (fake only). The
   * real client can't be forced into a zero-valid/400 deterministically, so it
   * runs with this false and only the happy-path + UPO + monotonicity assertions
   * apply.
   */
  supportsSeededFailures: boolean;
  /**
   * Max status polls before the suite gives up waiting for acceptance. Generous
   * enough for a real sandbox that clears asynchronously. Default 20.
   */
  maxPolls?: number;
}

const SESSIONS_ONLINE = '/sessions/online';
const IN_PROGRESS_CODES: ReadonlySet<number> = new Set([
  FAKE_KSEF_STATUS.PROCESSING_STARTED,
  FAKE_KSEF_STATUS.IN_PROGRESS,
]);

async function openSubmitClose(
  client: IKsefHttpClient,
): Promise<{ sessionRef: string; invoiceRef: string }> {
  const open = await client.post<{ referenceNumber: string }>(SESSIONS_ONLINE, {});
  const sessionRef = open.data.referenceNumber;
  expect(typeof sessionRef).toBe('string');
  expect(sessionRef.length).toBeGreaterThan(0);

  const submit = await client.post<{ referenceNumber: string }>(
    `${SESSIONS_ONLINE}/${encodeURIComponent(sessionRef)}/invoices`,
    {},
  );
  const invoiceRef = submit.data.referenceNumber;
  expect(typeof invoiceRef).toBe('string');
  expect(invoiceRef.length).toBeGreaterThan(0);

  await client.post(`${SESSIONS_ONLINE}/${encodeURIComponent(sessionRef)}/close`, undefined, {
    idempotent: true,
  });
  return { sessionRef, invoiceRef };
}

/** Session status read — `GET /sessions/{ref}`. */
async function readSessionStatus(
  client: IKsefHttpClient,
  sessionRef: string,
): Promise<OnlineSessionStatusResponse> {
  const res = await client.get<OnlineSessionStatusResponse>(
    `/sessions/${encodeURIComponent(sessionRef)}`,
  );
  return res.data;
}

async function readStatusCode(client: IKsefHttpClient, sessionRef: string): Promise<number> {
  return (await readSessionStatus(client, sessionRef)).status.code;
}

/**
 * Drive the contract against any `IKsefHttpClient` produced by `makeClient`.
 * Mirror this call from a real-client int-spec behind a creds env-gate so the
 * fake and the real implementation are held to one definition of behaviour.
 */
export function runKsefHttpClientContract(
  makeClient: () => IKsefHttpClient,
  opts: KsefClientContractOptions,
): void {
  const maxPolls = opts.maxPolls ?? 20;

  describe('IKsefHttpClient contract', () => {
    let client: IKsefHttpClient;

    beforeEach(() => {
      client = makeClient();
    });

    it('should advance a submitted invoice through in-progress to success (monotonic)', async () => {
      const { sessionRef } = await openSubmitClose(client);

      const observed: number[] = [];
      let accepted = false;
      for (let i = 0; i < maxPolls; i++) {
        const code = await readStatusCode(client, sessionRef);
        observed.push(code);
        if (code === FAKE_KSEF_STATUS.SUCCESS) {
          accepted = true;
          break;
        }
        expect(IN_PROGRESS_CODES.has(code)).toBe(true);
      }

      expect(accepted).toBe(true);
      // Monotonic: once successful, never observed an in-progress code afterwards
      // (the loop breaks on success, so every prior code was in-progress).
      const acceptedIdx = observed.indexOf(FAKE_KSEF_STATUS.SUCCESS);
      expect(acceptedIdx).toBe(observed.length - 1);
      observed.slice(0, acceptedIdx).forEach((code) => {
        expect(IN_PROGRESS_CODES.has(code)).toBe(true);
      });

      // Status read is stable after success, and the counts confirm one cleared.
      const settled = await readSessionStatus(client, sessionRef);
      expect(settled.status.code).toBe(FAKE_KSEF_STATUS.SUCCESS);
      expect(settled.successfulInvoiceCount).toBe(1);
    });

    it('should expose the UPO only after the invoice is accepted', async () => {
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      const upoPath = `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}/upo`;

      // Poll to acceptance first.
      let accepted = false;
      for (let i = 0; i < maxPolls && !accepted; i++) {
        accepted = (await readStatusCode(client, sessionRef)) === FAKE_KSEF_STATUS.SUCCESS;
      }
      expect(accepted).toBe(true);

      const upo = await client.get<{ upoDownloadUrl?: string }>(upoPath);
      expect(upo.status).toBe(200);
      expect(typeof upo.data.upoDownloadUrl).toBe('string');
      expect((upo.data.upoDownloadUrl ?? '').length).toBeGreaterThan(0);
    });

    it('should reject a UPO fetch before acceptance', async () => {
      // Fresh session, no status polls → not yet accepted.
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      const upoPath = `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}/upo`;
      await expect(client.get(upoPath)).rejects.toBeDefined();
    });

    if (opts.supportsSeededFailures) {
      it('should surface a processed-but-zero-valid session as 200 with successfulInvoiceCount 0', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.forceZeroValid();
        const { sessionRef } = await openSubmitClose(client);

        // Zero-valid still "processes" to 200; poll past any in-progress reads.
        let settled = await readSessionStatus(client, sessionRef);
        for (let i = 0; i < maxPolls && IN_PROGRESS_CODES.has(settled.status.code); i++) {
          settled = await readSessionStatus(client, sessionRef);
        }
        expect(settled.status.code).toBe(FAKE_KSEF_STATUS.SUCCESS);
        expect(settled.successfulInvoiceCount).toBe(0);
        expect(settled.failedInvoiceCount).toBe(1);
        // Sticky: a second read reports the same outcome (no UPO-bearing success).
        const reread = await readSessionStatus(client, sessionRef);
        expect(reread.successfulInvoiceCount).toBe(0);
      });

      it('should surface a per-invoice rejection as a terminal 400', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.seedStatus(FAKE_KSEF_STATUS.REJECTED);
        const { sessionRef, invoiceRef } = await openSubmitClose(client);

        // Rejection is sticky from the first read — no in-progress phase.
        const res = await client.get<InvoiceStatusResponse>(
          `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}`,
        );
        expect(res.data.status.code).toBe(FAKE_KSEF_STATUS.REJECTED);
      });

      it('should classify a transient 5xx as a thrown transport error, never a silent success', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.seedTransient(503, 1);
        const { sessionRef } = await openSubmitClose(client);

        // The fake emits the 5xx once; a caller-side retry (the next read) recovers.
        await expect(readStatusCode(client, sessionRef)).rejects.toBeDefined();

        // After the transient burst, the session resumes its normal lifecycle.
        let accepted = false;
        for (let i = 0; i < maxPolls && !accepted; i++) {
          const code = await readStatusCode(client, sessionRef);
          accepted = code === FAKE_KSEF_STATUS.SUCCESS;
        }
        expect(accepted).toBe(true);
      });
    }
  });
}
