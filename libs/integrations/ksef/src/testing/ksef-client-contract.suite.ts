/**
 * KSeF HTTP Client Contract Suite (#1153 / C9)
 *
 * A shared, transport-level behavioural contract that BOTH the in-memory
 * `FakeKsefClient` and the real `KsefHttpClient` must satisfy, so the fake used
 * across core's invoicing integration tests can't silently drift from the wire
 * behaviour C5/C6 depend on. The suite exercises the online-session document
 * flow through the `IKsefHttpClient` surface (`get` / `post` /
 * `postExpectingBinary`) and asserts:
 *
 *   1. STATUS TRANSITION — a freshly-submitted invoice reads in-progress
 *      (100/150) on early polls then `accepted` (200) on a later poll; the
 *      sequence is monotonic (never regresses from accepted back to in-progress).
 *   2. UPO AVAILABILITY — the UPO (binary) is fetchable ONLY after acceptance;
 *      a pre-acceptance fetch fails.
 *   3. TERMINAL FAILURES — `445` (session closed, zero valid invoices) and `210`
 *      (expired) surface on the session status read as the documented terminal
 *      codes (consistent with the C6 clearance-status mapper).
 *   4. 5xx CLASSIFICATION — a transient `5xx` on an idempotent read either
 *      recovers (the client retried) or surfaces as a thrown transport error —
 *      never a silent success.
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
import type { OnlineSessionStatusResponse } from '../infrastructure/adapters/ksef-session.types';
import { KSEF_SESSION_CLOSED_ZERO_VALID } from '../infrastructure/adapters/ksef-session.types';
import { FAKE_KSEF_STATUS } from './fake-ksef-client';

/** A seedable client exposes the failure-mode helpers the fake provides. */
interface SeedableKsefClient extends IKsefHttpClient {
  seedStatus(code: number): unknown;
  seedTransient(status?: number, times?: number): unknown;
  clear?(): void;
}

export interface KsefClientContractOptions {
  /**
   * When true the runner casts the client to `SeedableKsefClient` and exercises
   * the terminal-failure + transient-5xx cases by seeding them (fake only). The
   * real client can't be forced into a 445/210 deterministically, so it runs
   * with this false and only the happy-path + UPO + monotonicity assertions
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
  FAKE_KSEF_STATUS.RECEIVED,
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

async function readStatus(client: IKsefHttpClient, sessionRef: string): Promise<number> {
  const res = await client.get<OnlineSessionStatusResponse>(
    `${SESSIONS_ONLINE}/${encodeURIComponent(sessionRef)}`,
  );
  return res.data.status.code;
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

    it('should advance a submitted invoice through in-progress to accepted (monotonic)', async () => {
      const { sessionRef } = await openSubmitClose(client);

      const observed: number[] = [];
      let accepted = false;
      for (let i = 0; i < maxPolls; i++) {
        const code = await readStatus(client, sessionRef);
        observed.push(code);
        if (code === FAKE_KSEF_STATUS.ACCEPTED) {
          accepted = true;
          break;
        }
        expect(IN_PROGRESS_CODES.has(code)).toBe(true);
      }

      expect(accepted).toBe(true);
      // Monotonic: once accepted, never observed an in-progress code afterwards
      // (the loop breaks on acceptance, so every prior code was in-progress).
      const acceptedIdx = observed.indexOf(FAKE_KSEF_STATUS.ACCEPTED);
      expect(acceptedIdx).toBe(observed.length - 1);
      observed.slice(0, acceptedIdx).forEach((code) => {
        expect(IN_PROGRESS_CODES.has(code)).toBe(true);
      });

      // Status read is stable after acceptance.
      expect(await readStatus(client, sessionRef)).toBe(FAKE_KSEF_STATUS.ACCEPTED);
    });

    it('should expose the UPO only after the invoice is accepted', async () => {
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      const upoPath = `${SESSIONS_ONLINE}/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}/upo`;

      // Poll to acceptance first.
      let accepted = false;
      for (let i = 0; i < maxPolls && !accepted; i++) {
        accepted = (await readStatus(client, sessionRef)) === FAKE_KSEF_STATUS.ACCEPTED;
      }
      expect(accepted).toBe(true);

      const upo = await client.postExpectingBinary(upoPath);
      expect(upo.status).toBe(200);
      expect(upo.data.byteLength).toBeGreaterThan(0);
    });

    it('should reject a UPO fetch before acceptance', async () => {
      // Fresh session, no status polls → not yet accepted.
      const { sessionRef, invoiceRef } = await openSubmitClose(client);
      const upoPath = `${SESSIONS_ONLINE}/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}/upo`;
      await expect(client.postExpectingBinary(upoPath)).rejects.toBeDefined();
    });

    if (opts.supportsSeededFailures) {
      it('should surface 445 (session closed, zero valid invoices) on the status read', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.seedStatus(KSEF_SESSION_CLOSED_ZERO_VALID);
        const { sessionRef } = await openSubmitClose(client);

        const code = await readStatus(client, sessionRef);
        expect(code).toBe(KSEF_SESSION_CLOSED_ZERO_VALID);
        // Sticky terminal: a second read does not advance to accepted.
        expect(await readStatus(client, sessionRef)).toBe(KSEF_SESSION_CLOSED_ZERO_VALID);
      });

      it('should surface 210 (expired) as a terminal status', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.seedStatus(FAKE_KSEF_STATUS.EXPIRED);
        const { sessionRef } = await openSubmitClose(client);

        expect(await readStatus(client, sessionRef)).toBe(FAKE_KSEF_STATUS.EXPIRED);
      });

      it('should classify a transient 5xx as a thrown transport error, never a silent success', async () => {
        const seedable = client as SeedableKsefClient;
        seedable.seedTransient(503, 1);
        const { sessionRef } = await openSubmitClose(client);

        // The fake emits the 5xx once; a caller-side retry (the next read) recovers.
        await expect(readStatus(client, sessionRef)).rejects.toBeDefined();

        // After the transient burst, the session resumes its normal lifecycle.
        let accepted = false;
        for (let i = 0; i < maxPolls && !accepted; i++) {
          const code = await readStatus(client, sessionRef);
          accepted = code === FAKE_KSEF_STATUS.ACCEPTED;
        }
        expect(accepted).toBe(true);
      });
    }
  });
}
