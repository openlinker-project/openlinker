/**
 * KSeF Invoicing Adapter (#1149 / C5)
 *
 * Per-connection implementation of the neutral `InvoicingPort` + the
 * `RegulatoryTransmitter` and `CorrectionIssuer` (#1288) sub-capabilities
 * (ADR-002 / ADR-026) for the KSeF provider. Wires the C3 transport
 * (`IKsefHttpClient` + session crypto) and the C4 FA(3) builder into the
 * country-agnostic port: it consumes ONLY neutral `@openlinker/core/invoicing`
 * types and returns ONLY neutral results — no KSeF/FA(3)/NIP/UPO string ever
 * crosses back into core.
 *
 * `issueCorrection` (#1288) is a pure delegation into `issueInvoice`'s existing
 * KOR path: KSeF has no delta-only correction primitive, so every correction
 * resubmits a complete FA(3) document built from a caller-assembled
 * `IssueCorrectionCommand.originalDocument` snapshot (buyer/currency/lines
 * reconstructed by the caller from the order, since `InvoiceRecord` does not
 * persist them) plus the per-line deltas.
 *
 * `getClearanceStatus` (#1150 / C6) is the read primitive the reconciliation
 * job (#1121) calls — it polls the per-invoice status, maps the KSeF status code
 * onto the neutral `RegulatoryStatus`, and captures the assigned 35-char KSeF
 * number as the opaque `clearanceReference` on success. It also fetches the UPO
 * pointer to confirm availability, but C1's `ClearanceStatus` shape is strictly
 * `{ regulatoryStatus, clearanceReference }` (no `pdfUrl`/UPO field, ADR-026), so
 * the UPO reference does NOT ride back on the return value — C8 resolves the UPO
 * document from the `clearanceReference` (KSeF number), the stable key into the
 * UPO endpoint. This adapter NEVER schedules its own polling (no setInterval/
 * cron): #1121 owns the cron/worker scheduling so the two never double-poll;
 * this method is a single read invoked once per reconciliation tick.
 *
 * `issueInvoice` runs the online-session flow:
 *   1. Map the neutral command → `Fa3BuilderInput` (seller from connection
 *      config; buyer/lines/currency/taxId from the command), build + XSD-validate
 *      the FA(3) XML (C4).
 *   2. Open an online session (`POST /sessions/online`) with the RSA-wrapped AES
 *      key + IV, encrypt the document (AES-256-CBC), submit it
 *      (`POST .../invoices`), then close the session (`POST .../close`).
 *      One-invoice-per-session (batching is a future optimisation).
 *   3. KSeF assigns the KSeF number asynchronously — it is NOT returned at submit
 *      time. The adapter returns `regulatoryStatus='submitted'` +
 *      `clearanceReference=null`; C6 reconciles the cleared status later.
 *   4. A processed session with zero successful invoices (count-based check on
 *      the session status) → throw `KsefSessionException` (a terminal business
 *      failure, never a success).
 *
 * IDEMPOTENCY / PERSISTENCE: the adapter is a pure mechanism. It writes NOTHING
 * to any repository — it returns the neutral result and the core `InvoiceService`
 * (#1118) owns the `idempotencyKey` dedup gate and persistence. The returned
 * `InvoiceRecord` therefore carries an empty `id` and adapter-side timestamps;
 * the service assigns the real persisted identity. Callers must invoke this once
 * per issuance intent (the dedup gate above guarantees that).
 *
 * OUTAGE RESILIENCE (#1701 / mini-epic #1585, ADR-035): the adapter also
 * implements `OfflineResubmitter` + `RegulatoryRecordLocator`. When KSeF is
 * unavailable while opening/submitting a session (network failure / 429 / 5xx —
 * `isKsefUnavailable`), `issueInvoice` does NOT throw: the FA(3) is already
 * structurally issued locally, so it returns a neutral `pending-submission`
 * record (no `providerInvoiceId` — nothing landed) carrying the FA(3) XML as its
 * source document. A background sweep (#1121) later calls `resubmit` to open a
 * fresh session from that XML, and `locateByQuery` is the last-resort authority
 * lookup after a crash mid-submit. A content/validation rejection is still
 * terminal (it can never clear on resubmit) — offline mode is reserved for a
 * genuine outage (fiscal safety: never enter offline for a content rejection,
 * never fabricate a `providerInvoiceId`).
 *
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link InvoicingPort}
 * @see {@link RegulatoryTransmitter}
 * @see {@link OfflineResubmitter}
 * @see {@link RegulatoryRecordLocator}
 */
import { createHash } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import type {
  CorrectionIssuer,
  CorrectionLine,
  DocumentNumberConsumer,
  RegulatoryClearanceResult,
  DocumentType,
  GetInvoiceQuery,
  InvoiceLine,
  InvoiceRecord as InvoiceRecordType,
  InvoicingPort,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  IssuedDocumentSeller,
  OfflineResubmitResult,
  OfflineResubmitter,
  RegulatoryDocument,
  RegulatoryDocumentKind,
  RegulatoryDocumentReader,
  RegulatoryLocateCriteria,
  RegulatoryLocateResult,
  RegulatoryRecordLocator,
  RegulatoryTransmitter,
  StoredDocument,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord, UnsupportedRegulatoryDocumentKindError } from '@openlinker/core/invoicing';
import type { IKsefHttpClient } from '../http/ksef-http-client.interface';
import type { KsefSessionCryptoService } from '../crypto/ksef-session-crypto.service';
import type { SessionCryptoContext } from '../http/ksef-crypto.types';
import type { IFa3XmlBuilder } from '../fa3/builders/fa3-xml-builder.port';
import type { Fa3PaymentInput, SellerProfile } from '../fa3/domain/fa3-xml.types';
import {
  FA3_FORM_CODE,
  FA3_SCHEMA_VERSION,
  FA3_SYSTEM_CODE,
} from '../fa3/domain/fa3-xml.types';
import { mapToFa3BuilderInput } from '../fa3/domain/fa3-builder-input.mapper';
import { KsefNetworkException } from '../../domain/exceptions/ksef-network.exception';
import { decodeProviderInvoiceId, encodeProviderInvoiceId } from './ksef-provider-invoice-id';
import { KsefSessionException } from '../../domain/exceptions/ksef-session.exception';
import { KsefUnsupportedDocumentTypeException } from '../../domain/exceptions/ksef-unsupported-document-type.exception';
import { KsefInvalidCorrectionException } from '../../domain/exceptions/ksef-invalid-correction.exception';
import { KsefMissingDocumentNumberException } from '../../domain/exceptions/ksef-missing-document-number.exception';
import {
  KSEF_NUMBER_PATTERN,
  KSEF_STATUS_SUCCESS,
  type InvoiceMetadataItem,
  type InvoiceMetadataQueryRequest,
  type InvoiceMetadataQueryResponse,
  type InvoiceStatusResponse,
  type OnlineSessionStatusResponse,
  type OpenOnlineSessionRequest,
  type OpenOnlineSessionResponse,
  type SendInvoiceRequest,
  type SendInvoiceResponse,
} from './ksef-session.types';
import { mapKsefStatusToRegulatoryStatus } from './ksef-clearance-status.mapper';
import { isKsefUnavailable } from './ksef-availability';
import type { KsefInvoicingAdapterOptions } from './ksef-invoicing-adapter.types';

/** Neutral document types KSeF issues. Open-world `DocumentType` is narrowed to these two. */
const SUPPORTED_DOCUMENT_TYPES: DocumentType[] = ['invoice', 'corrected'];

/**
 * Max length of the FA(3) `P_2` document number (the KSeF/FA(3) schema caps it
 * at 256 chars). Declared to the core numbering allocation (#11) so an
 * over-length rendered number is rejected in OpenLinker before the session opens.
 */
const FA3_P2_MAX_LENGTH = 256;

/**
 * Default IANA timezone the numbering date variables + period-reset bucket
 * resolve in (#7) when the connection config carries none. Poland's zone: FA(3)
 * document dates are the seller's local dates, so an issuance just after local
 * midnight at a month/year boundary must number in the local calendar day.
 */
const DEFAULT_NUMBERING_TIME_ZONE = 'Europe/Warsaw';

/** Content type assumed for a UPO when KSeF omits the response `content-type` (the UPO is XML). */
const DEFAULT_UPO_CONTENT_TYPE = 'application/xml';

export class KsefInvoicingAdapter
  implements
    InvoicingPort,
    RegulatoryTransmitter,
    RegulatoryDocumentReader,
    CorrectionIssuer,
    DocumentNumberConsumer,
    OfflineResubmitter,
    RegulatoryRecordLocator
{
  private readonly logger = new Logger(KsefInvoicingAdapter.name);

  /**
   * Marks KSeF as an OpenLinker-numbered provider (#1575): the core
   * `InvoiceService` allocates the FA(3) `P_2` from the connection's numbering
   * series and passes it as `IssueInvoiceCommand.documentNumber`. Read by
   * `isDocumentNumberConsumer`.
   */
  readonly consumesDocumentNumber = true as const;

  /**
   * IANA timezone (#7) the core numbering allocation resolves the FA(3) date
   * variables + period-reset bucket in. Resolved by the factory from the
   * connection config (`Europe/Warsaw` default); read by the core `InvoiceService`.
   */
  readonly numberingTimeZone: string;

  /** FA(3) `P_2` max length (#11) declared to the core numbering allocation. */
  readonly maxDocumentNumberLength = FA3_P2_MAX_LENGTH;

  /**
   * Resolved connection-level payment defaults (#1311) — `undefined` when the
   * connection has none configured, in which case the builder omits
   * `Platnosc` entirely.
   */
  private readonly payment: Fa3PaymentInput | undefined;

  /**
   * Connection-level default unit of measure (`P_8A`, #1525) - `undefined`
   * when none is configured; unit-less lines then omit the element.
   */
  private readonly defaultLineUnit: string | undefined;

  /** Injected clock so the adapter (and its FA(3) timestamps) stay testable. */
  private readonly now: () => Date;

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IKsefHttpClient,
    private readonly sessionCrypto: KsefSessionCryptoService,
    private readonly fa3Builder: IFa3XmlBuilder,
    private readonly seller: SellerProfile,
    /**
     * Connection-resolved fallback `P_12` neutral code applied to any line
     * whose neutral `taxRate` arrives empty (see `Fa3MappingContext.defaultTaxRate`).
     */
    private readonly defaultTaxRate: string,
    /**
     * Trailing optional inputs (payment defaults #1311, injected clock) ride
     * in an options bag so a future addition never shifts positional call
     * sites (PR #1317 review).
     */
    options: KsefInvoicingAdapterOptions = {},
  ) {
    this.payment = options.payment;
    this.defaultLineUnit = options.defaultLineUnit;
    this.now = options.now ?? ((): Date => new Date());
    this.numberingTimeZone = options.numberingTimeZone ?? DEFAULT_NUMBERING_TIME_ZONE;
  }

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
    // `DocumentType` is open-world at the core boundary (#576); KSeF issues only
    // the subset getSupportedDocumentTypes advertises. Reject anything else up
    // front with a terminal exception so the service marks the record failed
    // rather than the adapter emitting a wrong document downstream.
    this.assertDocumentTypeSupported(cmd.documentType);
    // The FA(3) builder keys KOR emission off `correction !== undefined`, NOT the
    // document type — so an inconsistent command (corrected type without a
    // correction, or a correction without the corrected type) would silently emit
    // the wrong document. Assert the two agree, terminally, before any build/send.
    this.assertCorrectionConsistency(cmd);

    // Single issuance instant (#1692): the core `InvoiceService` threads ONE
    // `issuedAt` so the FA(3) `P_1` (legal issue date) and the allocated `P_2`
    // number's date variables/period resolve from the SAME instant. Fall back to
    // the injected clock only for a direct adapter call that does not thread one.
    const issuedAt = cmd.issuedAt ?? this.now();
    // The FA(3) P_2 document number (#1575). KSeF is a `DocumentNumberConsumer`:
    // the core `InvoiceService` allocates a real per-seller sequential number
    // from the connection's numbering series and passes it as
    // `cmd.documentNumber`. Single source for BOTH the XML builder's
    // `invoiceNumber` and the persisted `InvoiceRecord.providerInvoiceNumber` —
    // the correction precondition (#1289) matches on the persisted value, so the
    // two must never diverge (#1338). Corrections draw a distinct number from the
    // correction series upstream, so no per-correction suffix hack is needed here.
    const documentNumber = this.resolveDocumentNumber(cmd);
    this.logger.log(
      `Issuing KSeF document (connection ${this.connectionId}, order ${cmd.orderId}, lines ${cmd.lines.length})`,
    );
    this.warnOnEmptyTaxRateFallback(cmd);

    // 1. neutral → FA(3) (C4). Deterministic build faults throw the mapper's own
    //    typed exceptions; the service maps those to a failed record (no retry).
    const xml = this.fa3Builder.build(
      mapToFa3BuilderInput(cmd, {
        seller: this.seller,
        issueDate: this.toIsoDate(issuedAt),
        generatedAt: issuedAt.toISOString(),
        invoiceNumber: documentNumber,
        defaultTaxRate: this.defaultTaxRate,
        defaultLineUnit: this.defaultLineUnit,
        payment: this.payment,
      }),
    );

    // 2. Open session → encrypt → submit → close (one invoice per session).
    //    Establishing the session (crypto init + open) can fail because KSeF is
    //    unreachable (network / 429 / 5xx). The document is already structurally
    //    issued locally, so an OUTAGE here (#1701) does not fail issuance: it
    //    falls into the neutral offline (`pending-submission`) window for a later
    //    resubmit. A content/validation rejection still throws terminally.
    let cryptoContext: SessionCryptoContext;
    let sessionRef: string;
    try {
      cryptoContext = await this.sessionCrypto.initializeSession(issuedAt);
      sessionRef = await this.openOnlineSession(cryptoContext);
    } catch (error) {
      if (isKsefUnavailable(error)) {
        return this.buildOfflineResult(cmd, xml, issuedAt, documentNumber, error);
      }
      throw error;
    }

    let invoiceReference: string;
    let submitError: unknown;
    try {
      invoiceReference = await this.submitInvoice(sessionRef, xml, cryptoContext);
    } catch (error) {
      // Track the in-flight submit error so the finally-block close can't mask
      // it: on a failed submit a subsequent close failure is logged + swallowed,
      // preserving the original (more actionable) submit error.
      submitError = error;
      if (isKsefUnavailable(error)) {
        // OUTAGE mid-submit (#1701): the session opened but the document never
        // transmitted, so nothing landed at KSeF. Return the neutral offline
        // record — the finally below still closes the session best-effort, and
        // with `submitError` set a close failure is swallowed (never masks this).
        return this.buildOfflineResult(cmd, xml, issuedAt, documentNumber, error);
      }
      throw error;
    } finally {
      await this.closeSessionPreservingSubmitError(sessionRef, submitError);
    }

    // 3. KSeF rejects-with-zero-valid is reported on the session status, not the
    //    submit POST — read it so a zero-valid session is a loud failure, not a
    //    false success.
    await this.assertSessionAccepted(sessionRef);

    this.logger.log(
      `KSeF document submitted (connection ${this.connectionId}, session ref ${sessionRef}, invoice ref ${invoiceReference})`,
    );

    // 4. Neutral result. KSeF number is async (C6 reconciles) → clearanceReference null.
    //    providerInvoiceId packs BOTH the session ref and the invoice ref — the
    //    status/UPO read (C6) needs both for GET /sessions/{sref}/invoices/{iref}.
    //    The result also carries the neutral seller block (resolved from the
    //    connection's KsefSellerConfig) so the core InvoiceService can snapshot the
    //    issued-document content without core ever seeing a NIP/KSeF wire detail.
    const record = new InvoiceRecord(
      '', // persistence id is assigned by the core InvoiceService (#1118), not here.
      cmd.connectionId,
      cmd.orderId,
      'ksef',
      this.resolveDocumentType(cmd.documentType),
      'issued',
      encodeProviderInvoiceId(sessionRef, invoiceReference),
      // Leaving this null made the correction precondition in the HTTP
      // controller (#1289) reject every KSeF KOR with "missing document
      // number / issue date" (#1338).
      documentNumber,
      'submitted',
      null,
      cmd.idempotencyKey ?? null,
      null,
      issuedAt,
      null,
      issuedAt,
      issuedAt,
    );
    // Persist the FA(3) source XML as a neutral opaque blob so the core service can
    // re-serve `GET .../document?kind=source` without a KSeF round-trip (#1224 W3).
    return { record, seller: this.toNeutralSeller(), sourceDocument: this.toSourceDocument(xml) };
  }

  /**
   * `OfflineResubmitter.resubmit` (#1701). Retransmit a document that was issued
   * into the offline (`pending-submission`) window during a KSeF outage. Opens a
   * FRESH online session from the record's persisted FA(3) source XML and submits
   * it — the same online-session mechanism `issueInvoice` uses, minus its
   * offline-catch: if KSeF is STILL unavailable this THROWS (a transport/infra
   * failure) so the crash-recovery sweep (#1121) backs off and the record stays
   * `pending-submission` for the next tick, never silently lost.
   *
   * On accept-into-session it returns the neutral triple the sweep persists via
   * `updateOutcome`: the fresh `providerInvoiceId` (`{sessionRef}:{invoiceRef}`
   * composite — now knowable, unlike at offline-issue time), `regulatoryStatus`
   * `submitted` (the KSeF number is still assigned asynchronously — C6 reconciles
   * it to `accepted`), and `clearanceReference` null until then.
   */
  async resubmit(record: InvoiceRecordType): Promise<OfflineResubmitResult> {
    const xml = this.decodeOfflineDocument(record);
    // Reuse the record's original legal issue instant so the resubmitted FA(3)
    // carries the same `P_1` it was issued with (the offline document already
    // has legal effect from that date — the resubmit only transmits it).
    const issuedAt = record.issuedAt ?? this.now();
    this.logger.log(
      `Resubmitting offline KSeF document (connection ${this.connectionId}, order ${record.orderId})`,
    );

    const { sessionRef, invoiceReference } = await this.transmitToSession(xml, issuedAt);

    this.logger.log(
      `KSeF offline document resubmitted (connection ${this.connectionId}, ` +
        `session ref ${sessionRef}, invoice ref ${invoiceReference})`,
    );
    return {
      regulatoryStatus: 'submitted',
      providerInvoiceId: encodeProviderInvoiceId(sessionRef, invoiceReference),
      clearanceReference: null,
    };
  }

  /**
   * `RegulatoryRecordLocator.locateByQuery` (#1701). The last-resort crash-recovery
   * lookup: after a process died mid-submit, OL cannot know from its own state
   * whether KSeF received the document, so this queries the authority
   * (`POST /invoices/query/metadata`) by seller NIP + issue-date window + document
   * number and reports whether a match exists.
   *
   * Returns a neutral `RegulatoryLocateResult` on a match (KSeF number →
   * `clearanceReference`, `regulatoryStatus='accepted'` — a document present in
   * the metadata index has cleared), or `null` when the authority holds none (the
   * caller then treats the interrupted attempt as never having landed and
   * re-issues). A positive match REQUIRES an exact `documentNumber` hit (#1585 B1):
   * without one this returns `null` rather than trusting a lone date-window result,
   * which could belong to an unrelated invoice. `providerInvoiceId` is `null`: the metadata query does not expose
   * the `{sessionRef}:{invoiceRef}` composite this adapter's own id packs, and the
   * contract permits returning only what is available. A transport failure throws.
   */
  async locateByQuery(criteria: RegulatoryLocateCriteria): Promise<RegulatoryLocateResult | null> {
    // Filter by the seller NIP the sweep supplies, falling back to this
    // connection's own configured seller identity. `criteria.sellerTaxId` is a
    // neutral scheme-tagged value (ADR-026) — for KSeF it is the bare NIP.
    const sellerNip = criteria.sellerTaxId ?? this.seller.nip;
    const body: InvoiceMetadataQueryRequest = {
      subjectType: 'subject1',
      sellerNip,
      invoiceNumber: criteria.documentNumber,
      dateRange:
        criteria.issuedFrom || criteria.issuedTo
          ? {
              from: criteria.issuedFrom?.toISOString(),
              to: criteria.issuedTo?.toISOString(),
            }
          : undefined,
    };
    this.logger.log(
      `Locating KSeF document by metadata query (connection ${this.connectionId}, ` +
        `documentNumber ${criteria.documentNumber ?? 'any'})`,
    );

    const response = await this.httpClient.post<InvoiceMetadataQueryResponse>(
      '/invoices/query/metadata',
      body as unknown as Record<string, unknown>,
    );
    const match = this.selectMetadataMatch(response.data.invoices, criteria.documentNumber);
    if (!match) {
      return null;
    }
    return {
      // The metadata query surface does not carry the session-scoped composite
      // this adapter packs into its own `providerInvoiceId`; null is acceptable.
      providerInvoiceId: null,
      regulatoryStatus: 'accepted',
      clearanceReference: match.ksefNumber ?? null,
    };
  }

  /**
   * Pick the metadata item that matches the requested document number. A positive
   * match REQUIRES an exact document-number hit (#1585 B1, fiscal safety):
   *   - No document number supplied -> return `null`. The query is then scoped
   *     only by seller + issue-date window, and a lone date-window result can be
   *     an UNRELATED invoice the seller happened to issue in that window; trusting
   *     it would silently mis-attribute someone else's authority reference to an
   *     orphaned record. The caller resolves such a record to in-doubt instead.
   *   - Document number supplied -> match on it exactly client-side even when the
   *     server returned a single result, defending against a wire that ignores the
   *     `invoiceNumber` filter (a loose server-side filter never yields a
   *     wrong-positive).
   */
  private selectMetadataMatch(
    invoices: InvoiceMetadataItem[] | undefined,
    documentNumber: string | undefined,
  ): InvoiceMetadataItem | null {
    if (!documentNumber) {
      return null;
    }
    const items = invoices ?? [];
    return items.find((item) => item.invoiceNumber === documentNumber) ?? null;
  }

  /**
   * Build the neutral offline (`pending-submission`) result (#1701) for a document
   * issued during a KSeF outage: `status='issued'` (the FA(3) is structurally,
   * legally issued locally) with `regulatoryStatus='pending-submission'` and
   * `providerInvoiceId=null` (no session landed — NEVER fabricate a reference).
   * The FA(3) XML rides back as the neutral source document so the sweep can
   * resubmit it (`resubmit`) without a rebuild.
   */
  private buildOfflineResult(
    cmd: IssueInvoiceCommand,
    xml: string,
    issuedAt: Date,
    documentNumber: string,
    cause: unknown,
  ): IssueInvoiceResult {
    this.logger.warn(
      `KSeF unavailable during issuance (connection ${this.connectionId}, order ${cmd.orderId}); ` +
        `document issued into the offline pending-submission window for later resubmission. ` +
        `Cause: ${this.describeError(cause)}`,
    );
    const record = new InvoiceRecord(
      '', // persistence id is assigned by the core InvoiceService (#1118), not here.
      cmd.connectionId,
      cmd.orderId,
      'ksef',
      this.resolveDocumentType(cmd.documentType),
      'issued',
      null, // no session landed → no providerInvoiceId (fiscal safety: never fabricate one).
      documentNumber,
      'pending-submission',
      null,
      cmd.idempotencyKey ?? null,
      null,
      issuedAt,
      null,
      issuedAt,
      issuedAt,
    );
    return { record, seller: this.toNeutralSeller(), sourceDocument: this.toSourceDocument(xml) };
  }

  /**
   * Decode the FA(3) source XML persisted on an offline record (#1701). A record
   * with no source document cannot be resubmitted (nothing to transmit) — a
   * terminal precondition failure, so the sweep does not spin retrying it.
   */
  private decodeOfflineDocument(record: InvoiceRecordType): string {
    const source = record.sourceDocument;
    if (!source || !source.contentBase64) {
      throw new KsefSessionException(
        `Cannot resubmit KSeF offline document for order ${record.orderId}: ` +
          'the record carries no source-document XML to retransmit',
      );
    }
    return Buffer.from(source.contentBase64, 'base64').toString('utf-8');
  }

  /**
   * Open a fresh online session, submit the FA(3) XML, close it, and assert the
   * session was accepted — the throwing online-transmit primitive shared by
   * `resubmit`. Preserves the same submit-vs-close error precedence as
   * `issueInvoice` (a close failure never masks a submit failure). Unlike
   * `issueInvoice` it has NO offline-catch: every failure propagates.
   */
  private async transmitToSession(
    xml: string,
    issuedAt: Date,
  ): Promise<{ sessionRef: string; invoiceReference: string }> {
    const cryptoContext = await this.sessionCrypto.initializeSession(issuedAt);
    const sessionRef = await this.openOnlineSession(cryptoContext);
    let invoiceReference: string;
    let submitError: unknown;
    try {
      invoiceReference = await this.submitInvoice(sessionRef, xml, cryptoContext);
    } catch (error) {
      submitError = error;
      throw error;
    } finally {
      await this.closeSessionPreservingSubmitError(sessionRef, submitError);
    }
    await this.assertSessionAccepted(sessionRef);
    return { sessionRef, invoiceReference };
  }

  /**
   * Close the session in a finally block while preserving submit-error precedence:
   * a close failure after a SUCCESSFUL submit (`submitError === undefined`) is the
   * real (and only) error, so it is rethrown; a close failure after a FAILED
   * submit is logged + swallowed so it never masks the more actionable submit
   * error. Factored so `issueInvoice` and `transmitToSession` cannot drift.
   */
  private async closeSessionPreservingSubmitError(
    sessionRef: string,
    submitError: unknown,
  ): Promise<void> {
    try {
      await this.closeSession(sessionRef);
    } catch (closeError) {
      if (submitError === undefined) {
        throw closeError;
      }
      this.logger.warn(
        `KSeF session close failed after a failed submit (session ref ${sessionRef}); ` +
          `keeping the original submit error. Close error: ${this.describeError(closeError)}`,
      );
    }
  }

  /**
   * Resolve the FA(3) `P_2` from the core-allocated `cmd.documentNumber` (#1575).
   * KSeF is a `DocumentNumberConsumer`, so the core `InvoiceService` always
   * allocates and supplies it; a missing value is a wiring invariant violation,
   * thrown terminally before any session/XML work so the service records a
   * failure rather than the adapter emitting a document with no legal number.
   */
  private resolveDocumentNumber(cmd: IssueInvoiceCommand): string {
    const documentNumber = cmd.documentNumber?.trim();
    if (!documentNumber) {
      throw new KsefMissingDocumentNumberException(cmd.orderId);
    }
    return documentNumber;
  }

  /** Wrap the built FA(3) XML as a neutral, jsonb-persistable {@link StoredDocument}. */
  private toSourceDocument(xml: string): StoredDocument {
    return {
      contentType: 'application/xml',
      contentBase64: Buffer.from(xml, 'utf-8').toString('base64'),
    };
  }

  /**
   * Map the adapter's PL seller config (Podmiot1: NIP + name + address) onto the
   * neutral {@link IssuedDocumentSeller} the core content snapshot persists. The
   * `pl-nip` scheme tag is the ONLY place the PL identifier system is named — it
   * stays behind the adapter; core sees a scheme-tagged `TaxIdentifier`.
   */
  private toNeutralSeller(): IssuedDocumentSeller {
    return {
      name: this.seller.name,
      taxId: { scheme: 'pl-nip', value: this.seller.nip },
      address: {
        ...this.seller.address,
        line2: this.seller.address.line2 ?? null,
      },
    };
  }

  /**
   * `CorrectionIssuer`. KSeF has no delta-only correction primitive — every KOR
   * is a brand-new full FA(3) submission, so this is a PURE DELEGATION to the
   * already-tested `issueInvoice` KOR path (zero duplicated session/XML-build
   * logic): apply the per-line deltas onto the caller-assembled
   * `originalDocument` snapshot, then issue a `corrected` document referencing
   * the original. Throws `KsefInvalidCorrectionException` (terminal, no retry)
   * when the caller could not assemble a snapshot — KSeF cannot resubmit a KOR
   * without the full original buyer/currency/lines.
   *
   * `cmd.originalProviderInvoiceId` (the base-port `{sessionRef}:{invoiceRef}`
   * composite this adapter's OWN `providerInvoiceId` packs, used by
   * `getClearanceStatus` to poll a specific submission) is intentionally NOT
   * read here — the KOR linkage KSeF actually needs (the authority-assigned
   * KSeF number, human document number, issue date) travels on the neutral
   * `originalDocument` snapshot instead, since that's the caller-assembled
   * source of truth for what the original document looked like. The field
   * stays on the base `IssueCorrectionCommand` for adapters (e.g. Subiekt)
   * whose provider-native id IS the correction target.
   */
  async issueCorrection(cmd: IssueCorrectionCommand): Promise<IssueInvoiceResult> {
    if (!cmd.originalDocument) {
      throw new KsefInvalidCorrectionException(
        `Cannot issue a KSeF correction for order ${cmd.orderId}: the original invoice ` +
          'has no reconstructable document snapshot (buyer/currency/lines) to rebuild the corrected FA(3) from.',
      );
    }
    const correctedLines = this.applyCorrectionDeltas(cmd.originalDocument.lines, cmd.lines);
    // #1575: the correction's own P_2 is the number the core `InvoiceService`
    // allocated from the connection's CORRECTION series and passed as
    // `cmd.documentNumber`. Threaded onto the delegated `issueInvoice` so the KOR
    // carries a distinct, series-owned number — no per-correction suffix hack.
    const issueCmd: IssueInvoiceCommand = {
      connectionId: cmd.connectionId,
      orderId: cmd.orderId,
      documentNumber: cmd.documentNumber,
      // Thread the single issuance instant (#1692) onto the delegated issue so
      // the KOR's `P_1` matches the instant its correction number was allocated at.
      issuedAt: cmd.issuedAt,
      buyer: cmd.originalDocument.buyer,
      currency: cmd.originalDocument.currency,
      // Deliberately the UNMODIFIED original lines, NOT `correctedLines` — per
      // `CorrectionReference`'s contract, the command's top-level `lines` carry
      // the "before" state and `correction.correctedLines` carries the "after"
      // state; the FA(3) mapper reads both to build the KOR's before/after rows.
      lines: cmd.originalDocument.lines,
      documentType: cmd.documentType ?? 'corrected',
      correction: {
        originalClearanceReference: cmd.originalDocument.clearanceReference,
        originalDocumentNumber: cmd.originalDocument.documentNumber,
        originalIssueDate: cmd.originalDocument.issueDate,
        reason: cmd.reason ?? '',
        correctedLines,
      },
      idempotencyKey: cmd.idempotencyKey,
    };
    // `CorrectionIssuer.issueCorrection` now returns the full `IssueInvoiceResult`
    // (record + seller + sourceDocument), same as `issueInvoice` — a KOR's FA(3)
    // XML must be persisted and re-servable just like the original invoice's
    // (#1229 follow-up: the source document was previously discarded here,
    // leaving every correction's "View"/"Preview" with nothing to render).
    return this.issueInvoice(issueCmd);
  }

  /**
   * Apply per-line deltas onto a copy of the original lines, keeping `name`/
   * `taxRate` from the original (the delta carries only the changed
   * `newQuantity`/`newUnitPriceGross`). `originalLineNumber` is 1-based per
   * {@link CorrectionLine}'s contract.
   */
  private applyCorrectionDeltas(original: InvoiceLine[], deltas: CorrectionLine[]): InvoiceLine[] {
    const corrected = original.map((line) => ({ ...line }));
    for (const delta of deltas) {
      const index = delta.originalLineNumber - 1;
      const line = corrected[index];
      if (!line) {
        throw new KsefInvalidCorrectionException(
          `Correction line references originalLineNumber ${delta.originalLineNumber}, ` +
            `but the original document has only ${original.length} line(s)`,
        );
      }
      if (delta.newQuantity !== undefined) {
        line.quantity = delta.newQuantity;
      }
      if (delta.newUnitPriceGross !== undefined) {
        line.unitPriceGross = delta.newUnitPriceGross;
      }
    }
    return corrected;
  }

  /**
   * KSeF has no customer registry — `upsertCustomer` is a documented identity
   * echo. There is no provider-side customer to create/update: the buyer travels
   * with each issued document (Podmiot2). We resolve a stable provider customer
   * id from the buyer's neutral tax id when present (so the same buyer maps to a
   * stable handle), else a connection-scoped guest id. No network call is made.
   */
  upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    const taxId = cmd.buyer.taxId;
    const providerCustomerId = taxId
      ? `ksef:${taxId.scheme}:${taxId.value}`
      : `ksef:${this.connectionId}:guest`;
    return Promise.resolve({ providerCustomerId });
  }

  /**
   * `getInvoice` is a persistence-projection read owned by the core
   * `InvoiceService` (#1118), not the provider — KSeF offers no "get my issued
   * invoice by my order id" lookup. The adapter has no local store, so it returns
   * `null`; the service answers this from the `invoice_records` table.
   */
  getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecordType | null> {
    return Promise.resolve(null);
  }

  getSupportedDocumentTypes(): DocumentType[] {
    return [...SUPPORTED_DOCUMENT_TYPES];
  }

  /**
   * `RegulatoryTransmitter.submitForClearance` — for KSeF-direct, clearance
   * submission is folded into `issueInvoice`'s online-session send (the document
   * is transmitted to the authority at issue time). There is no separate submit
   * step, so this is a documented no-op that echoes the already-`submitted`
   * status; the live clearance outcome is read later via {@link getClearanceStatus}.
   */
  submitForClearance(record: InvoiceRecordType): Promise<RegulatoryClearanceResult> {
    return Promise.resolve({
      regulatoryStatus: record.regulatoryStatus === 'not-applicable' ? 'submitted' : record.regulatoryStatus,
      clearanceReference: record.clearanceReference,
    });
  }

  /**
   * Read the current clearance status by polling KSeF (#1150 / C6).
   *
   * Decodes the composite `providerInvoiceId` (`{sessionRef}:{invoiceRef}`, C5)
   * into both references, reads the session-scoped per-invoice status
   * (`GET /sessions/{sessionRef}/invoices/{invoiceRef}`), maps the KSeF status
   * code → neutral `RegulatoryStatus`, and on success captures the KSeF number as
   * the opaque `clearanceReference`. The UPO document pointer is fetched for
   * traceability but does NOT ride back on C1's neutral shape (see
   * {@link buildClearedStatus}). A `5xx` from KSeF propagates as a thrown
   * transport exception (transient — the #1121 job retries); a terminal business
   * status is returned as a `rejected` read result, not thrown.
   */
  async getClearanceStatus(reference: string | InvoiceRecordType): Promise<RegulatoryClearanceResult> {
    const { sessionRef, invoiceRef } = this.resolveInvoiceReference(reference);
    const statusPath = `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(
      invoiceRef,
    )}`;
    this.logger.log(
      `Reading KSeF clearance status (connection ${this.connectionId}, session ref ${sessionRef}, invoice ref ${invoiceRef})`,
    );

    const response = await this.httpClient.get<InvoiceStatusResponse>(statusPath);
    const code = response.data.status?.code;
    if (typeof code !== 'number') {
      throw new KsefSessionException(
        'KSeF invoice status read returned no status code',
        undefined,
        invoiceRef,
      );
    }

    const regulatoryStatus = mapKsefStatusToRegulatoryStatus(code);
    if (regulatoryStatus === null) {
      // Transient processing code (e.g. 550) — surface as a RETRYABLE transport
      // failure so the #1121 retry classifier backs off and re-polls, rather
      // than the non-retryable KsefApiException which would mark the job dead.
      throw new KsefNetworkException(
        `KSeF invoice status read returned transient status ${code}`,
        statusPath,
      );
    }

    if (regulatoryStatus !== 'accepted') {
      // Non-terminal (submitted) or terminal-failure (rejected): no KSeF number yet.
      return { regulatoryStatus, clearanceReference: null };
    }

    return this.buildClearedStatus(response.data, sessionRef, invoiceRef);
  }

  /**
   * `RegulatoryDocumentReader.getRegulatoryDocument` (#1224 / C15) — fetch the UPO confirmation
   * document for a cleared invoice as neutral bytes. Decodes the composite
   * `providerInvoiceId` into the session + invoice references and reads the
   * session-scoped UPO endpoint (`GET /sessions/{sessionRef}/invoices/{invoiceRef}/upo`)
   * as binary — the same authed path the clearance read uses, so no absolute-URL
   * auth edge case. KSeF returns the UPO as XML (the official confirmation); the
   * neutral `RegulatoryDocument` carries the provider-reported content type so the
   * HTTP boundary streams it back verbatim. A `4xx`/`5xx` propagates as a thrown
   * transport exception the controller maps (404/409/502); core sees only neutral
   * bytes, never a KSeF/UPO wire detail.
   */
  async getRegulatoryDocument(
    record: InvoiceRecordType,
    kind: RegulatoryDocumentKind = 'confirmation',
  ): Promise<RegulatoryDocument> {
    // `source` is the persisted FA(3) XML served by the core service from the
    // record snapshot, never via this adapter. `rendered` (server-side HTML/PDF
    // visualization) is not a KSeF API capability — integrators render the FA(3)
    // XML client-side via the official XSLT. Both are soft 409s, not failures.
    if (kind !== 'confirmation') {
      throw new UnsupportedRegulatoryDocumentKindError(kind);
    }
    const { sessionRef, invoiceRef } = this.resolveInvoiceReference(record);
    const upoPath = `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(
      invoiceRef,
    )}/upo`;
    this.logger.log(
      `Fetching UPO document (connection ${this.connectionId}, session ref ${sessionRef}, invoice ref ${invoiceRef})`,
    );

    const response = await this.httpClient.getExpectingBinary(upoPath);
    return {
      content: response.data,
      contentType: response.contentType.length > 0 ? response.contentType : DEFAULT_UPO_CONTENT_TYPE,
    };
  }

  /**
   * On a cleared invoice, capture the KSeF number (validated against the
   * authoritative pattern) as the neutral `clearanceReference`, and fetch the
   * UPO pointer.
   *
   * UPO LANDING (#1150 reconciliation note): C1's `ClearanceStatus` shape is
   * strictly `{ regulatoryStatus, clearanceReference }` — it has NO `pdfUrl`/
   * document-reference field, and ADR-026 forbids widening the neutral outcome
   * with a `ksef`/`upo` string. So the UPO reference cannot ride back on the
   * return value; we fetch it (confirming availability) and log a stable pointer
   * for traceability. C8 (UPO download) resolves the UPO document from the
   * `clearanceReference` (KSeF number) the record already carries.
   */
  private async buildClearedStatus(
    data: InvoiceStatusResponse,
    sessionRef: string,
    invoiceRef: string,
  ): Promise<RegulatoryClearanceResult> {
    const ksefNumber = data.ksefNumber;
    if (!ksefNumber || !KSEF_NUMBER_PATTERN.test(ksefNumber)) {
      throw new KsefSessionException(
        `KSeF reported success (status ${KSEF_STATUS_SUCCESS}) without a valid KSeF number`,
        KSEF_STATUS_SUCCESS,
        invoiceRef,
      );
    }

    const upoReference = await this.resolveUpoReference(data, sessionRef, invoiceRef);
    if (upoReference) {
      this.logger.log(
        `KSeF clearance accepted (connection ${this.connectionId}); UPO available at ${upoReference}`,
      );
    }

    return { regulatoryStatus: 'accepted', clearanceReference: ksefNumber };
  }

  /**
   * Resolve a stable UPO document URL for a cleared invoice. Prefers the
   * ready-to-use `upoDownloadUrl` KSeF already returned on the status payload;
   * otherwise reads the session-scoped UPO endpoint
   * (`GET /sessions/{sessionRef}/invoices/{invoiceRef}/upo`). Best-effort — a UPO
   * read failure does NOT fail the clearance read (the document cleared
   * regardless), so a transient UPO fetch error is swallowed and the #1121 job
   * re-resolves it next tick.
   */
  private async resolveUpoReference(
    data: InvoiceStatusResponse,
    sessionRef: string,
    invoiceRef: string,
  ): Promise<string | null> {
    if (data.upoDownloadUrl) {
      return data.upoDownloadUrl;
    }
    try {
      const upo = await this.httpClient.get<{ upoDownloadUrl?: string; downloadUrl?: string }>(
        `/sessions/${encodeURIComponent(sessionRef)}/invoices/${encodeURIComponent(invoiceRef)}/upo`,
      );
      return upo.data.upoDownloadUrl ?? upo.data.downloadUrl ?? null;
    } catch (error) {
      this.logger.warn(
        `KSeF UPO pointer fetch failed for a cleared invoice (connection ${this.connectionId}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Decode the composite `providerInvoiceId` (`{sessionRef}:{invoiceRef}`, C5)
   * into the session + invoice references the session-scoped status/UPO reads
   * need. A bare string is decoded the same way; a value that does not carry both
   * references (legacy record) cannot be read without a session ref, so we fail
   * loudly rather than guess.
   */
  private resolveInvoiceReference(reference: string | InvoiceRecordType): {
    sessionRef: string;
    invoiceRef: string;
  } {
    const providerInvoiceId =
      typeof reference === 'string' ? reference : reference.providerInvoiceId;
    if (!providerInvoiceId) {
      throw new KsefSessionException(
        'Cannot read KSeF clearance status: no invoice reference on the record',
      );
    }
    const decoded = decodeProviderInvoiceId(providerInvoiceId);
    if (!decoded) {
      throw new KsefSessionException(
        'Cannot read KSeF clearance status: providerInvoiceId is missing the session reference',
      );
    }
    return decoded;
  }

  private async openOnlineSession(context: SessionCryptoContext): Promise<string> {
    const body: OpenOnlineSessionRequest = {
      formCode: {
        systemCode: FA3_SYSTEM_CODE,
        schemaVersion: FA3_SCHEMA_VERSION,
        value: FA3_FORM_CODE,
      },
      encryption: {
        encryptedSymmetricKey: this.toBase64(context.wrappedKey.wrappedKey),
        initializationVector: this.toBase64(context.symmetricKey.iv),
      },
    };
    const response = await this.httpClient.post<OpenOnlineSessionResponse>(
      '/sessions/online',
      body as unknown as Record<string, unknown>,
    );
    if (!response.data.referenceNumber) {
      throw new KsefSessionException('KSeF /sessions/online returned no referenceNumber');
    }
    return response.data.referenceNumber;
  }

  private async submitInvoice(
    sessionRef: string,
    xml: string,
    context: SessionCryptoContext,
  ): Promise<string> {
    const plaintextBytes = Buffer.from(xml, 'utf8');
    const encrypted = this.sessionCrypto.encryptDocument(xml, context);
    const body: SendInvoiceRequest = {
      invoiceHash: this.sha256Base64(plaintextBytes),
      invoiceSize: plaintextBytes.byteLength,
      encryptedInvoiceHash: this.sha256Base64(encrypted.ciphertext),
      encryptedInvoiceSize: encrypted.ciphertext.byteLength,
      encryptedInvoiceContent: this.toBase64(encrypted.ciphertext),
    };
    const response = await this.httpClient.post<SendInvoiceResponse>(
      `/sessions/online/${encodeURIComponent(sessionRef)}/invoices`,
      body as unknown as Record<string, unknown>,
    );
    if (!response.data.referenceNumber) {
      throw new KsefSessionException(
        'KSeF invoice submit returned no referenceNumber',
        undefined,
        sessionRef,
      );
    }
    return response.data.referenceNumber;
  }

  private async closeSession(sessionRef: string): Promise<void> {
    // Closing is safe to repeat (idempotent at KSeF) — opt into transient retries.
    await this.httpClient.post(
      `/sessions/online/${encodeURIComponent(sessionRef)}/close`,
      undefined,
      { idempotent: true },
    );
  }

  private async assertSessionAccepted(sessionRef: string): Promise<void> {
    // Session status is GET /sessions/{ref} (NOT /sessions/online/{ref}, which has
    // no GET in the KSeF v2 spec — only POST for open + sub-resources).
    const response = await this.httpClient.get<OnlineSessionStatusResponse>(
      `/sessions/${encodeURIComponent(sessionRef)}`,
    );
    const { status, successfulInvoiceCount, failedInvoiceCount } = response.data;
    const code = status?.code;
    // Zero-valid terminal failure: a session that KSeF has *processed* yet cleared
    // *zero* invoices is the terminal failure for this synchronous path — there is
    // nothing to reconcile later. `noSuccesses` already folds an absent count to 0,
    // so the failed-count / strict-zero qualifiers were redundant (when noSuccesses
    // holds, successfulInvoiceCount === 0 always coalesces true).
    //
    // SAFETY NET (#1701, replaces the former pre-prod ASSUMPTION): we gate
    // "processed" on the session status code === KSEF_STATUS_SUCCESS (200). The
    // KSeF v2 OpenAPI documents 200 as the terminal success code on the analogous
    // auth-session status but does NOT publish a dedicated online-document-session
    // status-code catalogue, so a distinct session-PROCESSED code could in
    // principle exist. RESOLVED DECISION: keep the 200 gate (we deliberately do
    // NOT guess a new number) and treat any non-200 session as "submitted,
    // reconcile later" — but emit a structured WARN so the crash-recovery sweep
    // (#1121) monitors how often a non-terminal session slips through this
    // synchronous close, surfacing a stuck session in logs/metrics instead of
    // failing silently.
    const processed = code === KSEF_STATUS_SUCCESS;
    const noSuccesses = (successfulInvoiceCount ?? 0) === 0;
    if (processed && noSuccesses) {
      throw new KsefSessionException(
        `KSeF session processed with zero valid invoices (successful ${successfulInvoiceCount ?? 0}, failed ${failedInvoiceCount ?? 0})`,
        code,
        sessionRef,
      );
    }
    if (!processed) {
      // Non-terminal (still processing / unrecognised code): the KSeF number is
      // assigned asynchronously, so the cleared status is C6's concern. Monitored
      // here so a session that never reaches 200 is observable, not silent.
      this.logger.warn(
        `KSeF session non-terminal at issuance close; deferring to reconciliation ` +
          `(sessionRef=${sessionRef}, code=${code ?? 'none'}, ` +
          `successfulInvoiceCount=${successfulInvoiceCount ?? 0}, ` +
          `failedInvoiceCount=${failedInvoiceCount ?? 0})`,
      );
    }
  }

  /**
   * Reject a requested document type the adapter does not advertise. An absent /
   * empty type defaults to a plain invoice (supported) and passes; any explicit
   * type outside SUPPORTED_DOCUMENT_TYPES raises a terminal exception.
   */
  private assertDocumentTypeSupported(documentType?: string): void {
    if (!documentType || documentType.length === 0) {
      return;
    }
    if (!SUPPORTED_DOCUMENT_TYPES.includes(documentType as DocumentType)) {
      throw new KsefUnsupportedDocumentTypeException(documentType, SUPPORTED_DOCUMENT_TYPES);
    }
  }

  /**
   * Assert the command is internally consistent about being a correction. The
   * builder emits KOR iff `cmd.correction` is present; the neutral document type
   * must agree, or one side silently wins (a "corrected" type with no correction
   * emits a plain invoice; a correction with a non-corrected type emits a KOR for
   * a type the caller didn't ask for). Both mismatches are terminal.
   */
  private assertCorrectionConsistency(cmd: IssueInvoiceCommand): void {
    const isCorrected = cmd.documentType === 'corrected';
    const hasCorrection = cmd.correction !== undefined;
    if (isCorrected && !hasCorrection) {
      throw new KsefInvalidCorrectionException(
        "documentType is 'corrected' but no correction payload was supplied",
      );
    }
    if (hasCorrection && !isCorrected) {
      throw new KsefInvalidCorrectionException(
        "a correction payload was supplied but documentType is not 'corrected'" +
          ` (got ${cmd.documentType ?? 'undefined'})`,
      );
    }
  }

  /**
   * The pure `mapToFa3BuilderInput` mapper cannot log, so the audit trail for
   * the empty-`taxRate` → connection-`defaultTaxRate` substitution (#1290,
   * #1291) lives here instead — a WARN per issuance whose command carries at
   * least one line (plain or correction) with an empty neutral `taxRate`.
   */
  private warnOnEmptyTaxRateFallback(cmd: IssueInvoiceCommand): void {
    const emptyLineCount =
      cmd.lines.filter((line) => !line.taxRate).length +
      (cmd.correction?.correctedLines.filter((line) => !line.taxRate).length ?? 0);
    if (emptyLineCount > 0) {
      this.logger.warn(
        `KSeF document (connection ${this.connectionId}, order ${cmd.orderId}) has ` +
          `${emptyLineCount} line(s) with an empty neutral taxRate — falling back to the ` +
          `connection default (${this.defaultTaxRate}).`,
      );
    }
  }

  private resolveDocumentType(documentType?: string): string {
    // Validated by assertDocumentTypeSupported at the top of issueInvoice; an
    // absent type defaults to a plain invoice.
    return documentType && documentType.length > 0 ? documentType : 'invoice';
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private toIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }

  private sha256Base64(bytes: Uint8Array): string {
    return createHash('sha256').update(Buffer.from(bytes)).digest('base64');
  }
}
