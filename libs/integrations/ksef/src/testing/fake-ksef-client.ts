/**
 * Fake KSeF Client — in-memory `IKsefHttpClient` state machine (#1153 / C9)
 *
 * A behavioural test double for the KSeF online-session document flow at the
 * transport seam. Unlike `FakeKsefHttpClient` (a seed-a-canned-response-per-path
 * playback double for service/adapter unit specs), this fake models the REAL
 * session lifecycle as an in-memory state machine: open → submit → close →
 * status-poll (submitted → in-progress → accepted), with a deterministic 35-char
 * KSeF number + canned UPO on acceptance. It satisfies the shared contract suite
 * (`ksef-client-contract.suite.ts`) so the fake and the real `KsefHttpClient`
 * can't drift on the behaviours both must honour.
 *
 * Routes modelled (paths relative, leading-slash tolerant — mirrors the real
 * client's `path.replace(/^\//, '')`):
 *   - `POST /sessions/online`                         → open, returns session ref
 *   - `POST /sessions/online/{ref}/invoices`          → submit, returns invoice ref
 *   - `POST /sessions/online/{ref}/close`             → close (idempotent)
 *   - `GET  /sessions/online/{ref}`                   → session status (advances)
 *   - `GET  /invoices/{invoiceRef}`                   → invoice status (advances)
 *   - `POST /sessions/online/{ref}/invoices/{invoiceRef}/upo` (binary) → UPO,
 *     available ONLY after the invoice reaches `accepted` (200).
 *
 * DETERMINISM: no `Math.random` / `Date.now`. Session/invoice refs derive from a
 * seeded counter; the KSeF number derives from the seller NIP + an injected
 * issue date + the counter. An injected `now()` clock keeps any timestamps
 * reproducible.
 *
 * Kept off the main barrel (exposed via `@openlinker/integrations-ksef/testing`)
 * so test-only logic never enters the runtime bundle.
 *
 * @module libs/integrations/ksef/src/testing
 * @see {@link IKsefHttpClient}
 * @see {@link runKsefHttpClientContract}
 */
import type { IKsefHttpClient } from '../infrastructure/http/ksef-http-client.interface';
import type {
  KsefBinaryResponse,
  KsefHttpRequestOptions,
  KsefHttpResponse,
} from '../infrastructure/http/ksef-http-client.types';
import { KsefApiException } from '../domain/exceptions/ksef-api.exception';
import { KSEF_SESSION_CLOSED_ZERO_VALID } from '../infrastructure/adapters/ksef-session.types';

/**
 * KSeF-native session/invoice status codes the fake transitions through.
 * Mirrors the wire codes the C5 adapter + C6 mapper reason about: `100`/`150`
 * are in-progress (received / processing), `200` is accepted, `210` is an
 * expired/timeout terminal, `410` is rejected, `445` is "session closed with
 * zero valid invoices". Kept local to the fake — the real codes live on the
 * wire types and the C6 mapper, which the contract suite cross-checks.
 */
export const FAKE_KSEF_STATUS = {
  RECEIVED: 100,
  IN_PROGRESS: 150,
  ACCEPTED: 200,
  EXPIRED: 210,
  REJECTED: 410,
  CLOSED_ZERO_VALID: KSEF_SESSION_CLOSED_ZERO_VALID,
} as const;

/** A seedable terminal failure mode the fake forces on the next-opened session. */
export type FakeKsefFailureMode =
  | { kind: 'closed-zero-valid' } // 445
  | { kind: 'expired' } // 210
  | { kind: 'rejected' } // 410
  | { kind: 'transient'; status: number; times: number }; // 5xx N times, then succeed

export interface FakeKsefClientOptions {
  /**
   * Seller NIP woven into the deterministic KSeF number. Defaults to a fixed
   * 10-digit test NIP so a bare `new FakeKsefClient()` still yields a valid
   * 35-char reference.
   */
  sellerNip?: string;
  /**
   * Number of status polls a submitted invoice stays in-progress before it
   * flips to `accepted`. `0` = accepted on the first poll. Default `1`
   * (one in-progress read, then accepted).
   */
  inProgressPolls?: number;
  /** Injected clock for any timestamps; defaults to a fixed epoch for determinism. */
  now?: () => Date;
}

interface SessionState {
  sessionRef: string;
  invoiceRef: string | null;
  closed: boolean;
  /** How many status polls remain before acceptance (counts down on each GET). */
  pollsUntilAccepted: number;
  /** A terminal failure forced on this session, or null for the happy path. */
  failure: FakeKsefFailureMode | null;
  /** Remaining transient 5xx hits to emit on the next status read. */
  transientRemaining: number;
  ksefNumber: string | null;
}

interface RecordedCall {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  options?: KsefHttpRequestOptions;
}

const DEFAULT_SELLER_NIP = '1234567890';
const FIXED_CLOCK = new Date('2026-01-15T10:00:00.000Z');

export class FakeKsefClient implements IKsefHttpClient {
  readonly calls: RecordedCall[] = [];

  private readonly sellerNip: string;
  private readonly inProgressPolls: number;
  private readonly now: () => Date;

  private counter = 0;
  private readonly sessions = new Map<string, SessionState>();
  private readonly invoiceToSession = new Map<string, string>();
  /** A failure mode queued for the next-opened session. */
  private queuedFailure: FakeKsefFailureMode | null = null;

  constructor(options: FakeKsefClientOptions = {}) {
    this.sellerNip = options.sellerNip ?? DEFAULT_SELLER_NIP;
    this.inProgressPolls = options.inProgressPolls ?? 1;
    this.now = options.now ?? ((): Date => FIXED_CLOCK);
  }

  // --- Seeding / test helpers ------------------------------------------------

  /** Force the next-opened session to close with zero valid invoices (445). */
  seedRejection(): this {
    this.queuedFailure = { kind: 'rejected' };
    return this;
  }

  /** Force a specific terminal status (445 / 210 / 410) on the next session. */
  seedStatus(code: number): this {
    if (code === FAKE_KSEF_STATUS.CLOSED_ZERO_VALID) {
      this.queuedFailure = { kind: 'closed-zero-valid' };
    } else if (code === FAKE_KSEF_STATUS.EXPIRED) {
      this.queuedFailure = { kind: 'expired' };
    } else if (code === FAKE_KSEF_STATUS.REJECTED) {
      this.queuedFailure = { kind: 'rejected' };
    } else {
      throw new Error(`FakeKsefClient.seedStatus: unsupported terminal code ${code}`);
    }
    return this;
  }

  /** Force the next session's status read to emit a 5xx `times` times before succeeding. */
  seedTransient(status = 503, times = 1): this {
    this.queuedFailure = { kind: 'transient', status, times };
    return this;
  }

  clear(): void {
    this.calls.length = 0;
    this.counter = 0;
    this.sessions.clear();
    this.invoiceToSession.clear();
    this.queuedFailure = null;
  }

  // --- IKsefHttpClient surface ----------------------------------------------

  get<T = unknown>(path: string, options?: KsefHttpRequestOptions): Promise<KsefHttpResponse<T>> {
    this.calls.push({ method: 'GET', path, options });
    const normalized = this.normalize(path);
    const statusMatch = this.matchStatusPath(normalized);
    if (statusMatch) {
      return this.readStatus<T>(statusMatch);
    }
    return Promise.reject(this.apiError(404, path));
  }

  post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefHttpResponse<T>> {
    this.calls.push({ method: 'POST', path, body, options });
    const normalized = this.normalize(path);

    if (normalized === 'sessions/online') {
      return this.openSession<T>();
    }
    const submit = /^sessions\/online\/([^/]+)\/invoices$/.exec(normalized);
    if (submit) {
      return this.submitInvoice<T>(decodeURIComponent(submit[1]));
    }
    const close = /^sessions\/online\/([^/]+)\/close$/.exec(normalized);
    if (close) {
      return this.closeSession<T>(decodeURIComponent(close[1]));
    }
    return Promise.reject(this.apiError(404, path));
  }

  postExpectingBinary(
    path: string,
    _body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefBinaryResponse> {
    this.calls.push({ method: 'POST', path, options });
    const normalized = this.normalize(path);
    const upo = /^sessions\/online\/([^/]+)\/invoices\/([^/]+)\/upo$/.exec(normalized);
    if (!upo) {
      return Promise.reject(this.apiError(404, path));
    }
    const sessionRef = decodeURIComponent(upo[1]);
    const session = this.sessions.get(sessionRef);
    if (!session || session.ksefNumber === null) {
      // UPO is only available once the document has been accepted.
      return Promise.reject(this.apiError(404, path));
    }
    return Promise.resolve({
      data: this.cannedUpo(session.ksefNumber),
      contentType: 'application/pdf',
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    });
  }

  // --- State machine ---------------------------------------------------------

  private openSession<T>(): Promise<KsefHttpResponse<T>> {
    const sessionRef = this.nextRef('SESSION');
    const failure = this.queuedFailure;
    this.queuedFailure = null;
    this.sessions.set(sessionRef, {
      sessionRef,
      invoiceRef: null,
      closed: false,
      pollsUntilAccepted: this.inProgressPolls,
      failure,
      transientRemaining: failure?.kind === 'transient' ? failure.times : 0,
      ksefNumber: null,
    });
    return Promise.resolve(this.ok<T>(201, { referenceNumber: sessionRef }));
  }

  private submitInvoice<T>(sessionRef: string): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(sessionRef);
    if (!session) {
      return Promise.reject(this.apiError(404, `sessions/online/${sessionRef}/invoices`));
    }
    const invoiceRef = this.nextRef('INVOICE');
    session.invoiceRef = invoiceRef;
    this.invoiceToSession.set(invoiceRef, sessionRef);
    return Promise.resolve(this.ok<T>(202, { referenceNumber: invoiceRef }));
  }

  private closeSession<T>(sessionRef: string): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(sessionRef);
    if (!session) {
      return Promise.reject(this.apiError(404, `sessions/online/${sessionRef}/close`));
    }
    session.closed = true;
    return Promise.resolve(this.ok<T>(200, {}));
  }

  private readStatus<T>(ref: { sessionRef: string }): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(ref.sessionRef);
    if (!session) {
      return Promise.reject(this.apiError(404, `sessions/online/${ref.sessionRef}`));
    }

    // Transient 5xx burst: emit then count down, so a retrying caller eventually succeeds.
    if (session.transientRemaining > 0) {
      session.transientRemaining -= 1;
      const status = session.failure?.kind === 'transient' ? session.failure.status : 503;
      return Promise.reject(this.apiError(status, `sessions/online/${ref.sessionRef}`));
    }

    const code = this.resolveStatusCode(session);
    return Promise.resolve(this.ok<T>(200, { status: { code, description: this.describe(code) } }));
  }

  /**
   * Advance the session's status on each poll. Terminal failures (445/210/410)
   * are sticky and never advance; the happy path counts in-progress polls down
   * to acceptance and stamps the deterministic KSeF number on arrival.
   */
  private resolveStatusCode(session: SessionState): number {
    if (session.failure?.kind === 'closed-zero-valid') {
      return FAKE_KSEF_STATUS.CLOSED_ZERO_VALID;
    }
    if (session.failure?.kind === 'expired') {
      return FAKE_KSEF_STATUS.EXPIRED;
    }
    if (session.failure?.kind === 'rejected') {
      return FAKE_KSEF_STATUS.REJECTED;
    }

    if (session.ksefNumber !== null) {
      return FAKE_KSEF_STATUS.ACCEPTED;
    }
    if (session.pollsUntilAccepted > 0) {
      session.pollsUntilAccepted -= 1;
      // First in-progress read reports RECEIVED, subsequent ones IN_PROGRESS.
      return session.pollsUntilAccepted === this.inProgressPolls - 1
        ? FAKE_KSEF_STATUS.RECEIVED
        : FAKE_KSEF_STATUS.IN_PROGRESS;
    }
    session.ksefNumber = this.deterministicKsefNumber();
    return FAKE_KSEF_STATUS.ACCEPTED;
  }

  // --- Deterministic value derivation ---------------------------------------

  private nextRef(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(6, '0')}`;
  }

  /**
   * Deterministic 35-char KSeF number: `{NIP10}-{RRRRMMDD}-{HEX6}-{HEX5}-{CC2}`.
   * Lengths: 10 + 1 + 8 + 1 + 6 + 1 + 5 + 1 + 2 = 35. Derived from the seller
   * NIP, the injected date, and the seeded counter — no randomness.
   */
  private deterministicKsefNumber(): string {
    const date = this.now();
    const yyyymmdd = `${date.getUTCFullYear()}${this.pad2(date.getUTCMonth() + 1)}${this.pad2(date.getUTCDate())}`;
    const seed = this.counter.toString(16).toUpperCase().padStart(11, '0');
    const block1 = seed.slice(0, 6);
    const block2 = seed.slice(6, 11);
    const checksum = this.pad2((this.counter * 7) % 100);
    return `${this.sellerNip}-${yyyymmdd}-${block1}-${block2}-${checksum}`;
  }

  private cannedUpo(ksefNumber: string): Uint8Array {
    // Minimal deterministic "PDF" payload tagged with the KSeF number bytes.
    return new TextEncoder().encode(`%PDF-1.4 FAKE-UPO ${ksefNumber}`);
  }

  // --- Helpers ---------------------------------------------------------------

  private matchStatusPath(normalized: string): { sessionRef: string } | null {
    const session = /^sessions\/online\/([^/]+)$/.exec(normalized);
    if (session) {
      return { sessionRef: decodeURIComponent(session[1]) };
    }
    const invoice = /^invoices\/([^/]+)$/.exec(normalized);
    if (invoice) {
      const sessionRef = this.invoiceToSession.get(decodeURIComponent(invoice[1]));
      return sessionRef ? { sessionRef } : null;
    }
    return null;
  }

  private normalize(path: string): string {
    const [pathOnly] = path.split('?');
    return pathOnly.replace(/^\//, '');
  }

  private ok<T>(status: number, data: unknown): KsefHttpResponse<T> {
    return { data: data as T, status, headers: {} };
  }

  private apiError(status: number, path: string): KsefApiException {
    return new KsefApiException(`FakeKsefClient ${status} for ${path}`, status, undefined, path);
  }

  private describe(code: number): string {
    switch (code) {
      case FAKE_KSEF_STATUS.RECEIVED:
        return 'Received';
      case FAKE_KSEF_STATUS.IN_PROGRESS:
        return 'In progress';
      case FAKE_KSEF_STATUS.ACCEPTED:
        return 'Accepted';
      case FAKE_KSEF_STATUS.EXPIRED:
        return 'Expired';
      case FAKE_KSEF_STATUS.REJECTED:
        return 'Rejected';
      case FAKE_KSEF_STATUS.CLOSED_ZERO_VALID:
        return 'Session closed with zero valid invoices';
      default:
        return 'Unknown';
    }
  }

  private pad2(n: number): string {
    return String(n).padStart(2, '0');
  }
}
