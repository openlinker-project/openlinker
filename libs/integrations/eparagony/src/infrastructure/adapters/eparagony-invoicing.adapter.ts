/**
 * eparagony.pl Invoicing Adapter
 *
 * `InvoicingPort` + `RegulatoryStatusReader` over the vendor's `eInvoice`
 * document kind - the SECOND capability on the same connection and the same
 * plugin as `EparagonyFiscalizationAdapter`, so one connection can register
 * receipts and issue invoices without the operator configuring the provider
 * twice. Both adapters share one `EparagonyHttpClient`, which owns the OAuth
 * token cache; the existing scope set already covers invoicing.
 *
 * THE VENDOR IS NOT THE AUTHORITY, AND THAT SHAPES EVERYTHING BELOW. It issues
 * the invoice and then RELAYS it to the national e-invoicing hub on the seller's
 * behalf. So this adapter implements `RegulatoryStatusReader` (poll the relay's
 * progress) and NOT `RegulatoryTransmitter` (which is for a provider OpenLinker
 * submits to directly) - the same split `InfaktInvoicingAdapter` sits on.
 *
 * FOUR BEHAVIOURS DESERVE THE READER'S ATTENTION.
 *
 * 1. **`issueInvoice` blocks on a bounded status poll**, exactly as
 *    `registerTransaction` does. The create answers `202 Accepted` before the
 *    document exists, and `issued` is a claim core persists and shows an
 *    operator. The poll stops as soon as the document's EXISTENCE is settled -
 *    `CONFIRMED` or `OFFLINE` (issued, awaiting relay) or `ERROR` - and never
 *    waits for the hub, which can legitimately take days and has its own
 *    reconciliation (`getClearanceStatus`).
 *
 * 2. **Nothing is guessed about a value the vendor judges.** The buyer's tax
 *    number travels verbatim (ADR-073 decision 5) and is checksum-verified on
 *    the vendor's side, so its refusal is a reachable, ordinary
 *    `EparagonyApiError` classified `rejected` - never a crash, and never a
 *    pre-emptive refusal on this adapter's own authority.
 *
 * 3. **Every composition failure happens BEFORE the boundary.** An unresolvable
 *    tax rate, a currency that would need an exchange rate, a connection with no
 *    seller tax number, a document kind this adapter does not issue: all
 *    `EparagonyConfigException`, `failureMode: 'rejected'`, nothing sent and
 *    therefore nothing issued.
 *
 * 4. **The document's own per-line figures come back with it.** The neutral
 *    `IssueInvoiceResult.documentLines` carries the net, tax and gross this
 *    adapter put on each line, keyed by the line's position in the command.
 *    Omitting it would leave core falling back to a per-line
 *    `round(gross / (1 + r))`, which is exactly the arithmetic the mapper
 *    rejects - so OpenLinker's own contents card would disagree by a grosz with
 *    the document it describes on any order that needed a residual absorbed.
 *
 * The adapter is a PURE MECHANISM: it never deduplicates and holds no state.
 * Idempotency, persistence and the exactly-once guarantee belong to core.
 *
 * NOT IMPLEMENTED HERE, deliberately: `CorrectionIssuer`. The vendor models a
 * correction as its own `eCorrectiveInvoice` document kind with its own
 * before/after metadata pair, which is a document this adapter does not compose
 * (#3193).
 *
 * @module libs/integrations/eparagony/src/infrastructure/adapters
 */
import { randomUUID } from 'node:crypto';

import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  DocumentType,
  GetInvoiceQuery,
  InvoicingPort,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  IssuedDocumentLineAmounts,
  RegulatoryClearanceResult,
  RegulatoryStatusReader,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';

import { EPARAGONY_ISSUE_DEADLINE_MS, EPARAGONY_PROVIDER_TYPE } from '../../eparagony.constants';
import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';
import {
  deriveDocumentToken,
  deriveTransactionToken,
} from '../../domain/policies/document-token.policy';
import {
  EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS,
  EPARAGONY_ERROR_UNKNOWN_DOCUMENT,
  EPARAGONY_STATUS_CONFIRMED,
  EPARAGONY_STATUS_ERROR,
  EPARAGONY_STATUS_OFFLINE,
  type EparagonyCreateInvoiceRequest,
  type EparagonyDocumentStatusResponse,
} from '../../domain/types/eparagony-api.types';
import type { EparagonyConnectionConfig } from '../../domain/types/eparagony-config.types';
import type { IEparagonyHttpClient } from '../http/eparagony-http-client.interface';
import { readDocumentStatus } from './eparagony-document.mapper';
import {
  composeInvoiceDocument,
  readDocumentUrl,
  readInvoiceNumber,
  resolveBuyerHandleSchemeTag,
  toIssuedDocumentSeller,
  toRegulatoryClearanceResult,
} from './eparagony-invoice.mapper';

const DOCUMENTS_PATH = 'documents';

/** The only neutral document type this adapter issues today; corrections are #3193. */
const SUPPORTED_DOCUMENT_TYPES: readonly DocumentType[] = ['invoice'];

/**
 * Default ceiling on the issuance status poll. Well under
 * {@link EPARAGONY_ISSUE_DEADLINE_MS} so the create (with its own transport
 * retries) fits inside the same budget.
 */
const DEFAULT_STATUS_POLL_TIMEOUT_MS = 45_000;

/** Floor on an operator-configured poll timeout. */
const MIN_STATUS_POLL_TIMEOUT_MS = 5_000;

/** Ceiling on an operator-configured poll timeout, so the deadline cannot be configured away. */
const MAX_STATUS_POLL_TIMEOUT_MS = 90_000;

const STATUS_POLL_INITIAL_DELAY_MS = 1_000;
const STATUS_POLL_BACKOFF_MULTIPLIER = 1.6;
const STATUS_POLL_MAX_DELAY_MS = 5_000;

// Fail loud at module load if the poll ceiling is ever raised past the whole-call
// deadline, which would let one issuance outlive core's in-flight CAS lease.
if (MAX_STATUS_POLL_TIMEOUT_MS >= EPARAGONY_ISSUE_DEADLINE_MS) {
  throw new Error(
    `eparagony.pl fiscal-safety invariant violated: MAX_STATUS_POLL_TIMEOUT_MS ` +
      `(${MAX_STATUS_POLL_TIMEOUT_MS}ms) must stay below EPARAGONY_ISSUE_DEADLINE_MS ` +
      `(${EPARAGONY_ISSUE_DEADLINE_MS}ms).`
  );
}

/**
 * Statuses at which the document exists and the poll may RETURN it. `ERROR` is
 * deliberately absent - it is settled too, but it throws one branch earlier, and
 * listing it here would read as a status this function can return.
 *
 * `OFFLINE` counts: the invoice is issued, with legal effect, and only its relay
 * to the hub is outstanding - waiting for that here would block issuance on a
 * process with no bounded duration, which is what `getClearanceStatus` is for.
 */
const ISSUED_STATUSES: readonly string[] = [EPARAGONY_STATUS_CONFIRMED, EPARAGONY_STATUS_OFFLINE];

export class EparagonyInvoicingAdapter implements InvoicingPort, RegulatoryStatusReader {
  constructor(
    private readonly connectionId: string,
    private readonly http: IEparagonyHttpClient,
    private readonly logger: LoggerPort,
    private readonly config: EparagonyConnectionConfig
  ) {}

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
    this.assertIssuableDocument(cmd);

    const registrationKey = this.resolveRegistrationKey(cmd);
    const documentToken = deriveDocumentToken(this.connectionId, registrationKey);
    const transactionToken = deriveTransactionToken(this.connectionId, registrationKey);

    // Composition failures throw `EparagonyConfigException`
    // (`failureMode: 'rejected'`) BEFORE anything crosses the boundary.
    const { request, documentLines } = composeInvoiceDocument({
      command: cmd,
      config: this.config,
      documentToken,
      transactionToken,
    });

    const deadline = Date.now() + EPARAGONY_ISSUE_DEADLINE_MS;

    await this.createDocument(request, documentToken, cmd.orderId);
    const status = await this.pollToSettledIssuance(documentToken, deadline, cmd.orderId);

    return this.toIssueResult(cmd, status, documentToken, documentLines);
  }

  /**
   * Refuse a document this adapter does not issue, before anything is composed.
   *
   * `getSupportedDocumentTypes()` declares `['invoice']` and NOTHING ENFORCES IT
   * on this path: `InvoiceService.issueInvoice` does not gate on the declaration
   * (only `AutoIssueTriggerService` performs an adapter-level check), so
   * `POST /invoices` reaches here unguarded. Left alone, a caller asking for
   * another kind would get a plain VAT invoice at the vendor while the persisted
   * record was stamped with the type it asked for - two documents disagreeing
   * about what was issued, one of them transmitted to a tax authority.
   *
   * A correction is the concrete case and the reason this exists: the vendor
   * models one as its own `eCorrectiveInvoice` document with its own
   * before/after metadata pair, which this adapter does not compose (#3193), and
   * `cmd.correction` is read nowhere else here - so without this guard the
   * linkage would be silently dropped. Refusing makes the #3193 boundary
   * explicit rather than implicit.
   *
   * `EparagonyConfigException` for both, so `failureMode` is `'rejected'` with
   * nothing sent - which is exactly true here, and makes re-attempting safe once
   * the caller asks for a document this adapter issues.
   */
  private assertIssuableDocument(cmd: IssueInvoiceCommand): void {
    if (cmd.correction !== undefined) {
      throw new EparagonyConfigException(
        `eparagony.pl cannot issue a correction for order ${cmd.orderId}: a correction is the ` +
          `vendor's own eCorrectiveInvoice document, which this adapter does not compose`,
        'This connection cannot issue correction documents yet, only original invoices.',
        this.connectionId
      );
    }

    const documentType = cmd.documentType;
    // Widened to `string[]` because the command's `documentType` is open-world
    // while `DocumentType` is a closed union - the comparison is the point, and
    // narrowing the caller's value first would be the check writing its own answer.
    const supported: readonly string[] = SUPPORTED_DOCUMENT_TYPES;
    if (documentType !== undefined && !supported.includes(documentType)) {
      throw new EparagonyConfigException(
        `eparagony.pl cannot issue document type "${documentType}" for order ${cmd.orderId}: ` +
          `this adapter issues ${supported.join(', ')} only`,
        'This connection cannot issue the requested document type; it issues invoices only.',
        this.connectionId
      );
    }
  }

  /**
   * `getInvoice` is a persistence-projection read owned by the core
   * `InvoiceService` (#1118), not the provider - the vendor's only document read
   * is keyed by its own path token and publishes no search by order id. The
   * adapter has no local store, so it returns `null`; the service answers this
   * from the `invoice_records` table.
   */
  getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    return Promise.resolve(null);
  }

  /**
   * The vendor keeps no customer registry - `upsertCustomer` is a documented
   * identity echo, the shape the KSeF adapter established. There is nothing
   * provider-side to create or update: the buyer travels with each issued
   * document. A stable handle is resolved from the buyer's neutral tax id when
   * there is one, else a connection-scoped guest id. No network call is made.
   */
  upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    const taxId = cmd.buyer.taxId;
    // `scheme` is optional since ADR-073 decision 1, so interpolating it raw
    // would render `eparagony:undefined:5213796333` and split one buyer across
    // two handles depending on which path issued.
    const providerCustomerId =
      taxId === null
        ? `${EPARAGONY_PROVIDER_TYPE}:${this.connectionId}:guest`
        : `${EPARAGONY_PROVIDER_TYPE}:${resolveBuyerHandleSchemeTag(taxId.scheme, taxId.value)}:${taxId.value}`;
    return Promise.resolve({ providerCustomerId });
  }

  getSupportedDocumentTypes(): DocumentType[] {
    return [...SUPPORTED_DOCUMENT_TYPES];
  }

  /**
   * `RegulatoryStatusReader.getClearanceStatus` - read the relay's progress off
   * the same `GET /documents/{token}/status` the issuance poll uses, keyed on
   * the deterministic token stored as `providerInvoiceId`.
   *
   * A record with no provider id ECHOES the record's own current values rather
   * than reporting `not-applicable`. There is genuinely nothing to read, and
   * `not-applicable` is TERMINAL in the neutral lifecycle - claiming it would
   * stop the reconciliation looking at a document whose relay may be perfectly
   * healthy, on the strength of a missing id. Echoing persists what is already
   * there and changes nothing.
   *
   * A transport failure propagates for the reconciliation to retry; a business
   * verdict, including `rejected`, comes back as data.
   */
  async getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult> {
    const documentToken = record.providerInvoiceId;
    if (documentToken === null || documentToken.trim().length === 0) {
      this.logger.warn(
        `eparagony.pl cannot read clearance for invoice record ${record.id}: it carries no ` +
          `document token [connectionId=${this.connectionId}]`
      );
      return {
        regulatoryStatus: record.regulatoryStatus,
        clearanceReference: record.clearanceReference,
      };
    }

    const status = await this.readStatus(documentToken, { treatUnknownDocumentAsMissing: true });
    if (status === null) {
      // The vendor holds no document under a token we minted, which is a
      // statement about OUR record rather than about the relay. Same reasoning
      // as the no-id branch: report no change rather than terminalising.
      this.logger.warn(
        `eparagony.pl holds no document ${documentToken} for invoice record ${record.id} ` +
          `[connectionId=${this.connectionId}]`
      );
      return {
        regulatoryStatus: record.regulatoryStatus,
        clearanceReference: record.clearanceReference,
      };
    }

    return toRegulatoryClearanceResult(status);
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  private async createDocument(
    body: EparagonyCreateInvoiceRequest,
    documentToken: string,
    orderId: string
  ): Promise<void> {
    try {
      await this.http.post<unknown>(DOCUMENTS_PATH, body, {
        // `documentToken`, NOT core's raw `idempotencyKey`: the vendor requires
        // this header to match `/^[0-9A-Za-z_-]+$/` and core's key carries
        // colons. The token is a deterministic derivation of the same pair,
        // shaped as a UUID, so it satisfies the character class while keeping
        // the identical safety property the header exists for.
        headers: { 'Idempotency-Key': documentToken },
        // Safe to re-issue on a 5xx/network failure precisely BECAUSE of the
        // header above: repeating a key with the same body cannot mint a second
        // document, and therefore cannot issue a second invoice.
        idempotent: true,
      });
      this.logger.log(
        `eparagony.pl accepted the invoice for order ${orderId} as ${documentToken} ` +
          `[connectionId=${this.connectionId}]`
      );
    } catch (error) {
      if (
        error instanceof EparagonyApiError &&
        error.errorCode === EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS
      ) {
        // Our token is deterministic, so "already exists" means OUR earlier
        // attempt landed. Reporting a rejection here would be the wrong-direction
        // error: the status read below resolves what actually happened.
        this.logger.warn(
          `eparagony.pl already holds document ${documentToken} for order ${orderId}; ` +
            `reading its status instead of re-creating [connectionId=${this.connectionId}]`
        );
        return;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Status poll
  // -------------------------------------------------------------------------

  /**
   * Poll until the document's existence is settled, or the budget runs out.
   *
   * `ERROR` is the one definite rejection the vendor reports and throws.
   * `PENDING` is not settled - the document is still being issued - so it keeps
   * polling; an unrecognised status does too, which is the safe reading, since
   * claiming `issued` on a status this build cannot interpret would persist a
   * document that may not exist.
   */
  private async pollToSettledIssuance(
    documentToken: string,
    deadline: number,
    orderId: string
  ): Promise<EparagonyDocumentStatusResponse> {
    let delay = STATUS_POLL_INITIAL_DELAY_MS;
    const pollUntil = Math.min(deadline, Date.now() + this.resolvePollTimeoutMs());
    let lastStatus: string | null = null;

    for (;;) {
      const body = await this.readStatus(documentToken, {
        treatUnknownDocumentAsMissing: false,
      });
      // `treatUnknownDocumentAsMissing: false` never returns null.
      const status = body === null ? null : readDocumentStatus(body);
      lastStatus = status ?? lastStatus;

      if (body !== null && status === EPARAGONY_STATUS_ERROR) {
        throw this.toTerminalRejection(body, documentToken, orderId);
      }
      if (body !== null && status !== null && ISSUED_STATUSES.includes(status)) {
        return body;
      }

      const remaining = pollUntil - Date.now();
      if (remaining <= 0) {
        // The vendor may still issue it. Never a rejection - `EparagonyNetworkError`
        // is always `in-doubt`, which is exactly right: a document may exist.
        throw new EparagonyNetworkError(
          `eparagony.pl did not settle invoice document ${documentToken} for order ${orderId} ` +
            `within the poll budget (last status "${lastStatus ?? 'unknown'}")`
        );
      }
      await sleep(Math.min(delay, remaining));
      delay = Math.min(delay * STATUS_POLL_BACKOFF_MULTIPLIER, STATUS_POLL_MAX_DELAY_MS);
    }
  }

  /**
   * Terminal `ERROR`: the vendor explicitly reports the invoice was not issued.
   * `rejected` is safe here for the reason it is on the receipt path - OL sends
   * its own derived token as the vendor's `Idempotency-Key`, so re-crossing the
   * boundary under the same key cannot issue a second document, which is what
   * the neutral definition of `rejected` requires.
   *
   * The operational consequence, recorded honestly: because the vendor replays
   * the same key idempotently, a re-attempt under the same registration key
   * returns this same failed document. A genuine retry needs a fresh key.
   */
  private toTerminalRejection(
    body: EparagonyDocumentStatusResponse,
    documentToken: string,
    orderId: string
  ): EparagonyApiError {
    const errorCode = typeof body.errorCode === 'number' ? body.errorCode : null;
    // The vendor's `errorDescription` can echo a submitted line name, so it is
    // logged but never promoted into the operator-facing reason core persists.
    const description =
      typeof body.errorDescription === 'string' ? body.errorDescription : 'no description';
    this.logger.warn(
      `eparagony.pl reported a terminal invoicing error for document ${documentToken} ` +
        `(order ${orderId}, code ${errorCode ?? 'none'}): ${description} ` +
        `[connectionId=${this.connectionId}]`
    );
    return new EparagonyApiError(
      `eparagony.pl reported a terminal invoicing error for document ${documentToken} ` +
        `(code ${errorCode ?? 'none'})`,
      // Not an HTTP status - the read itself succeeded. Recorded as the vendor's
      // own code so a support conversation has something to key on.
      200,
      { errorCode },
      {
        failureMode: 'rejected',
        reason:
          'The invoicing provider reported an error and did not issue the invoice. Fix the reported problem, then issue again under a new key.',
      }
    );
  }

  /**
   * Read one document status.
   *
   * `treatUnknownDocumentAsMissing` converts the vendor's "no such token"
   * rejection into `null`. The issuance poll never asks for that, because a
   * document that vanished mid-poll is not a clean absence and must stay in doubt.
   */
  private async readStatus(
    documentToken: string,
    options: { treatUnknownDocumentAsMissing: boolean }
  ): Promise<EparagonyDocumentStatusResponse | null> {
    try {
      const { data } = await this.http.get<EparagonyDocumentStatusResponse>(
        `${DOCUMENTS_PATH}/${encodeURIComponent(documentToken)}/status`
      );
      // A body that is not an object at all is a contract break, not a status.
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new EparagonyNetworkError(
          `eparagony.pl returned a non-object status body for document ${documentToken}`
        );
      }
      return data;
    } catch (error) {
      if (
        options.treatUnknownDocumentAsMissing &&
        error instanceof EparagonyApiError &&
        error.errorCode !== null &&
        EPARAGONY_ERROR_UNKNOWN_DOCUMENT.includes(error.errorCode)
      ) {
        return null;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  private toIssueResult(
    cmd: IssueInvoiceCommand,
    status: EparagonyDocumentStatusResponse,
    documentToken: string,
    documentLines: IssuedDocumentLineAmounts[]
  ): IssueInvoiceResult {
    const clearance = toRegulatoryClearanceResult(status);
    const now = new Date();
    const record = new InvoiceRecord(
      randomUUID(),
      this.connectionId,
      cmd.orderId,
      EPARAGONY_PROVIDER_TYPE,
      cmd.documentType ?? 'invoice',
      'issued',
      // The vendor's ONLY document key, and ours: deterministic, so a later
      // clearance read re-derives it from the same registration key.
      documentToken,
      readInvoiceNumber(status),
      clearance.regulatoryStatus,
      clearance.clearanceReference ?? null,
      cmd.idempotencyKey ?? null,
      // The vendor publishes an HTML visualisation rather than a PDF, and this
      // is the only slot on the neutral record for a link to the issued
      // document. Unlike the receipt lane it is NOT gated on `CONFIRMED`: an
      // invoice at `OFFLINE` is issued with legal effect and its visualisation
      // carries the authority's own offline verification codes.
      readDocumentUrl(status),
      // Core's single issuance instant when it supplied one. The vendor's own
      // `endTime` is deliberately NOT used: it came back as an instant in the
      // PAST on a freshly-issued document, which looks like a window boundary
      // rather than an issue time, and surfacing it would misdate the document.
      cmd.issuedAt ?? now,
      null,
      now,
      now
    );

    const seller = toIssuedDocumentSeller(this.config);
    // `documentLines` is ALWAYS reported: this adapter composes the figures
    // itself, so there is never a line it cannot state. `seller` stays optional
    // because it genuinely depends on what the connection configures.
    return seller === null ? { record, documentLines } : { record, seller, documentLines };
  }

  /**
   * The key both tokens are derived from.
   *
   * `IssueInvoiceCommand.idempotencyKey` is optional, and without one there is
   * nothing deterministic to derive from - so a per-(connection, order) key
   * stands in. That is not a weaker guarantee for the invariant that matters:
   * one order on one connection gets one document either way, which is the
   * one-originating-document rule (ADR-041) expressed at the token.
   */
  private resolveRegistrationKey(cmd: IssueInvoiceCommand): string {
    const supplied = cmd.idempotencyKey?.trim() ?? '';
    return supplied.length > 0 ? supplied : `invoice:${this.connectionId}:${cmd.orderId}`;
  }

  /** Clamp the operator's poll timeout into the range the deadline invariant allows. */
  private resolvePollTimeoutMs(): number {
    const configured = this.config.statusPollTimeoutMs;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return DEFAULT_STATUS_POLL_TIMEOUT_MS;
    }
    return Math.min(Math.max(configured, MIN_STATUS_POLL_TIMEOUT_MS), MAX_STATUS_POLL_TIMEOUT_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
