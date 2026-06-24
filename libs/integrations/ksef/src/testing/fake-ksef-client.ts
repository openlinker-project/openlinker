/**
 * Fake KSeF Client — in-memory `IKsefHttpClient` state machine (#1153 / C9)
 *
 * A behavioural test double for the KSeF online-session document flow at the
 * transport seam. Unlike `FakeKsefHttpClient` (a seed-a-canned-response-per-path
 * playback double for service/adapter unit specs), this fake models the REAL
 * session lifecycle as an in-memory state machine: open → submit → close →
 * status-poll (processing → success), with a deterministic 35-char KSeF number +
 * canned UPO pointer on acceptance. It satisfies the shared contract suite
 * (`ksef-client-contract.suite.ts`) so the fake and the real `KsefHttpClient`
 * can't drift on the behaviours both must honour.
 *
 * Routes modelled (paths relative, leading-slash tolerant — mirrors the real
 * client's `path.replace(/^\//, '')`):
 *   - `POST /sessions/online`                              → open, returns session ref
 *   - `POST /sessions/online/{ref}/invoices`               → submit, returns invoice ref
 *   - `POST /sessions/online/{ref}/close`                  → close (idempotent)
 *   - `GET  /sessions/{ref}`                               → session status (advances)
 *   - `GET  /sessions/{ref}/invoices/{invoiceRef}`         → per-invoice status (advances)
 *   - `GET  /sessions/{ref}/invoices/{invoiceRef}/upo`     → UPO pointer JSON,
 *     available ONLY after the invoice reaches success (200).
 *
 * Open/send/close stay under `/sessions/online`; status + UPO reads are
 * session-scoped under `/sessions/{ref}` — reconciled against the authoritative
 * KSeF API v2 OpenAPI + the official CIRFMF C# client (#1147–#1151).
 *
 * STATUS MODEL (count-based, not magic terminal codes): the authoritative codes
 * are `100`/`150` (processing), `200` (Success), `400` (rejection), `5xx`
 * (transient). There is no `210`/`410`/`445`. A "processed but nothing cleared"
 * terminal failure is expressed on the SESSION status as
 * `{ status:{code:200}, invoiceCount:1, successfulInvoiceCount:0,
 * failedInvoiceCount:1 }` (zero-valid), and a per-invoice rejection as
 * `status.code === 400`.
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
import {
  KSEF_STATUS_PROCESSING_STARTED,
  KSEF_STATUS_IN_PROGRESS,
  KSEF_STATUS_SUCCESS,
} from '../infrastructure/adapters/ksef-session.types';

/**
 * KSeF-native status codes the fake transitions through. Mirrors the
 * authoritative wire codes the C5 adapter + C6 mapper reason about: `100`/`150`
 * are in-progress (processing started / in progress), `200` is Success, `400`
 * is a terminal per-invoice rejection. There is NO `210`/`410`/`445` — a
 * "processed but nothing cleared" outcome is modelled with the session-status
 * COUNTS (`successfulInvoiceCount === 0`), not a magic code.
 */
export const FAKE_KSEF_STATUS = {
  PROCESSING_STARTED: KSEF_STATUS_PROCESSING_STARTED,
  IN_PROGRESS: KSEF_STATUS_IN_PROGRESS,
  SUCCESS: KSEF_STATUS_SUCCESS,
  REJECTED: 400,
} as const;

/** A seedable terminal failure mode the fake forces on the next-opened session. */
export type FakeKsefFailureMode =
  | { kind: 'zero-valid' } // processed (200) but successfulInvoiceCount === 0
  | { kind: 'rejected' } // per-invoice terminal rejection (400)
  | { kind: 'transient'; status: number; times: number }; // 5xx N times, then succeed

export interface FakeKsefClientOptions {
  /**
   * Seller NIP woven into the deterministic KSeF number. Defaults to a fixed
   * 10-digit test NIP that satisfies the authoritative KsefNumber leading-digit
   * constraint so a bare `new FakeKsefClient()` still yields a valid reference.
   */
  sellerNip?: string;
  /**
   * Number of status polls a submitted invoice stays in-progress before it
   * flips to success. `0` = success on the first poll. Default `1`
   * (one in-progress read, then success).
   */
  inProgressPolls?: number;
  /** Injected clock for any timestamps; defaults to a fixed epoch for determinism. */
  now?: () => Date;
}

interface SessionState {
  sessionRef: string;
  invoiceRef: string | null;
  closed: boolean;
  /** How many status polls remain before success (counts down on each GET). */
  pollsUntilSuccess: number;
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

/**
 * Default seller NIP — the real-format example `5265877635`, which satisfies the
 * authoritative KsefNumber leading-digit constraint (`[1-9](\d[1-9]|[1-9]\d)…`).
 */
const DEFAULT_SELLER_NIP = '5265877635';
const FIXED_CLOCK = new Date('2026-01-15T10:00:00.000Z');
/** Earliest year the authoritative KsefNumber date segment accepts. */
const MIN_KSEF_YEAR = 2020;

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

  /** Force the next-opened session to a per-invoice terminal rejection (400). */
  seedRejection(): this {
    this.queuedFailure = { kind: 'rejected' };
    return this;
  }

  /**
   * Force the next session to terminate processed-but-zero-valid: the session
   * status reads `200` with `successfulInvoiceCount === 0`.
   */
  forceZeroValid(): this {
    this.queuedFailure = { kind: 'zero-valid' };
    return this;
  }

  /**
   * Force a specific terminal status on the next session. `400` → per-invoice
   * rejection. (Zero-valid is keyed on the session COUNTS, not a code; use
   * {@link forceZeroValid}.)
   */
  seedStatus(code: number): this {
    if (code === FAKE_KSEF_STATUS.REJECTED) {
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

    const upo = /^sessions\/([^/]+)\/invoices\/([^/]+)\/upo$/.exec(normalized);
    if (upo) {
      return this.readUpoPointer<T>(decodeURIComponent(upo[1]));
    }
    const invoiceStatus = /^sessions\/([^/]+)\/invoices\/([^/]+)$/.exec(normalized);
    if (invoiceStatus) {
      return this.readInvoiceStatus<T>(decodeURIComponent(invoiceStatus[1]));
    }
    const sessionStatus = /^sessions\/([^/]+)$/.exec(normalized);
    if (sessionStatus) {
      return this.readSessionStatus<T>(decodeURIComponent(sessionStatus[1]));
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
    return Promise.reject(this.apiError(404, path));
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
      pollsUntilSuccess: this.inProgressPolls,
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

  /**
   * Session status read (`GET /sessions/{ref}` → `OnlineSessionStatusResponse`):
   * resolves the current code and emits the per-invoice counts. A zero-valid
   * terminal reads `200` with `successfulInvoiceCount === 0`; the happy path
   * counts one successful invoice once accepted.
   */
  private readSessionStatus<T>(sessionRef: string): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(sessionRef);
    if (!session) {
      return Promise.reject(this.apiError(404, `sessions/${sessionRef}`));
    }

    const transient = this.consumeTransient(session, `sessions/${sessionRef}`);
    if (transient) {
      return Promise.reject(transient);
    }

    const code = this.resolveStatusCode(session);
    return Promise.resolve(this.ok<T>(200, this.sessionStatusBody(session, code)));
  }

  /**
   * Per-invoice status read
   * (`GET /sessions/{ref}/invoices/{invoiceRef}` → `SessionInvoiceStatusResponse`).
   * On success (`code === 200`) carries the assigned `ksefNumber` and a flat
   * `upoDownloadUrl`.
   */
  private readInvoiceStatus<T>(sessionRef: string): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(sessionRef);
    if (!session) {
      return Promise.reject(this.apiError(404, `sessions/${sessionRef}/invoices`));
    }

    const transient = this.consumeTransient(session, `sessions/${sessionRef}/invoices`);
    if (transient) {
      return Promise.reject(transient);
    }

    const code = this.resolveStatusCode(session);
    const body: Record<string, unknown> = { status: { code, description: this.describe(code) } };
    if (code === FAKE_KSEF_STATUS.SUCCESS && session.ksefNumber !== null) {
      body.ksefNumber = session.ksefNumber;
      body.upoDownloadUrl = this.upoUrl(session.ksefNumber);
    }
    return Promise.resolve(this.ok<T>(200, body));
  }

  /**
   * UPO pointer read (`GET /sessions/{ref}/invoices/{invoiceRef}/upo`). Returns a
   * `{ upoDownloadUrl }` JSON pointer ONLY once the invoice has been accepted.
   */
  private readUpoPointer<T>(sessionRef: string): Promise<KsefHttpResponse<T>> {
    const session = this.sessions.get(sessionRef);
    if (!session || session.ksefNumber === null) {
      // UPO is only available once the document has been accepted.
      return Promise.reject(this.apiError(404, `sessions/${sessionRef}/invoices/upo`));
    }
    return Promise.resolve(this.ok<T>(200, { upoDownloadUrl: this.upoUrl(session.ksefNumber) }));
  }

  /**
   * Emit the next transient 5xx for the session if one is pending, counting it
   * down so a retrying caller eventually gets through. Returns the error to
   * reject with, or null when no transient remains.
   */
  private consumeTransient(session: SessionState, path: string): KsefApiException | null {
    if (session.transientRemaining <= 0) {
      return null;
    }
    session.transientRemaining -= 1;
    const status = session.failure?.kind === 'transient' ? session.failure.status : 503;
    return this.apiError(status, path);
  }

  /**
   * Advance the session's status on each poll. A queued `rejected` failure is
   * sticky and never advances; the happy path (incl. zero-valid, which still
   * "processes" to 200) counts in-progress polls down to success and stamps the
   * deterministic KSeF number on arrival.
   */
  private resolveStatusCode(session: SessionState): number {
    if (session.failure?.kind === 'rejected') {
      return FAKE_KSEF_STATUS.REJECTED;
    }

    if (session.ksefNumber !== null) {
      return FAKE_KSEF_STATUS.SUCCESS;
    }
    if (session.pollsUntilSuccess > 0) {
      session.pollsUntilSuccess -= 1;
      // First in-progress read reports PROCESSING_STARTED, subsequent ones IN_PROGRESS.
      return session.pollsUntilSuccess === this.inProgressPolls - 1
        ? FAKE_KSEF_STATUS.PROCESSING_STARTED
        : FAKE_KSEF_STATUS.IN_PROGRESS;
    }
    // Zero-valid still "processes" (200 on the session) but stamps no KSeF number
    // and clears no invoice; the counts express the failure.
    if (session.failure?.kind !== 'zero-valid') {
      session.ksefNumber = this.deterministicKsefNumber();
    }
    return FAKE_KSEF_STATUS.SUCCESS;
  }

  /**
   * Build an `OnlineSessionStatusResponse` body. Once the session has processed
   * (code 200), the counts reflect the outcome: a zero-valid session reports
   * one failed / zero successful; the happy path reports one successful.
   */
  private sessionStatusBody(session: SessionState, code: number): Record<string, unknown> {
    const body: Record<string, unknown> = { status: { code, description: this.describe(code) } };
    if (code === FAKE_KSEF_STATUS.SUCCESS) {
      const zeroValid = session.failure?.kind === 'zero-valid';
      body.invoiceCount = 1;
      body.successfulInvoiceCount = zeroValid ? 0 : 1;
      body.failedInvoiceCount = zeroValid ? 1 : 0;
    }
    return body;
  }

  // --- Deterministic value derivation ---------------------------------------

  private nextRef(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${String(this.counter).padStart(6, '0')}`;
  }

  /**
   * Deterministic 35-char KSeF number matching the authoritative KsefNumber
   * pattern. The pattern accepts an OPTIONAL dash between the two 6-hex groups
   * (`[0-9A-F]{6}-?[0-9A-F]{6}`); this builds the dash-less 35-char form
   * `{NIP10}-{YYYYMMDD}-{HEX6}{HEX6}-{HEX2}` (10 + 1 + 8 + 1 + 6 + 6 + 1 + 2 =
   * 35). Derived from the seller NIP, the injected date (clamped to a valid
   * year), and the seeded counter — no randomness.
   */
  private deterministicKsefNumber(): string {
    const date = this.now();
    const year = Math.max(date.getUTCFullYear(), MIN_KSEF_YEAR);
    const yyyymmdd = `${year}${this.pad2(date.getUTCMonth() + 1)}${this.pad2(date.getUTCDate())}`;
    // Two independent 6-hex groups derived from the counter (uppercase).
    const seed = (this.counter * 0x1000001).toString(16).toUpperCase().padStart(12, '0').slice(-12);
    const block1 = seed.slice(0, 6);
    const block2 = seed.slice(6, 12);
    const checksum = (this.counter % 256).toString(16).toUpperCase().padStart(2, '0');
    return `${this.sellerNip}-${yyyymmdd}-${block1}${block2}-${checksum}`;
  }

  private upoUrl(ksefNumber: string): string {
    return `https://fake-ksef.local/upo/${ksefNumber}.pdf`;
  }

  // --- Helpers ---------------------------------------------------------------

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
      case FAKE_KSEF_STATUS.PROCESSING_STARTED:
        return 'Processing started';
      case FAKE_KSEF_STATUS.IN_PROGRESS:
        return 'In progress';
      case FAKE_KSEF_STATUS.SUCCESS:
        return 'Success';
      case FAKE_KSEF_STATUS.REJECTED:
        return 'Rejected';
      default:
        return 'Unknown';
    }
  }

  private pad2(n: number): string {
    return String(n).padStart(2, '0');
  }
}
