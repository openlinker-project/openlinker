/**
 * KSeF Invoicing Adapter (#1149 / C5)
 *
 * Per-connection implementation of the neutral `InvoicingPort` + the
 * `RegulatoryTransmitter` sub-capability (ADR-002 / ADR-026) for the KSeF
 * provider. Wires the C3 transport (`IKsefHttpClient` + session crypto) and the
 * C4 FA(3) builder into the country-agnostic port: it consumes ONLY neutral
 * `@openlinker/core/invoicing` types and returns ONLY neutral results — no
 * KSeF/FA(3)/NIP/UPO string ever crosses back into core.
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
 * @module libs/integrations/ksef/src/infrastructure/adapters
 * @see {@link InvoicingPort}
 * @see {@link RegulatoryTransmitter}
 */
import { createHash } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import type {
  RegulatoryClearanceResult,
  DocumentType,
  GetInvoiceQuery,
  InvoiceRecord as InvoiceRecordType,
  InvoicingPort,
  IssueInvoiceCommand,
  RegulatoryDocument,
  RegulatoryDocumentReader,
  RegulatoryTransmitter,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type { IKsefHttpClient } from '../http/ksef-http-client.interface';
import type { KsefSessionCryptoService } from '../crypto/ksef-session-crypto.service';
import type { SessionCryptoContext } from '../http/ksef-crypto.types';
import type { IFa3XmlBuilder } from '../fa3/builders/fa3-xml-builder.port';
import type { SellerProfile } from '../fa3/domain/fa3-xml.types';
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
import {
  KSEF_NUMBER_PATTERN,
  KSEF_STATUS_SUCCESS,
  type InvoiceStatusResponse,
  type OnlineSessionStatusResponse,
  type OpenOnlineSessionRequest,
  type OpenOnlineSessionResponse,
  type SendInvoiceRequest,
  type SendInvoiceResponse,
} from './ksef-session.types';
import { mapKsefStatusToRegulatoryStatus } from './ksef-clearance-status.mapper';

/** Neutral document types KSeF issues. Open-world `DocumentType` is narrowed to these two. */
const SUPPORTED_DOCUMENT_TYPES: DocumentType[] = ['invoice', 'corrected'];

/** Content type assumed for a UPO when KSeF omits the response `content-type` (the UPO is XML). */
const DEFAULT_UPO_CONTENT_TYPE = 'application/xml';

export class KsefInvoicingAdapter
  implements InvoicingPort, RegulatoryTransmitter, RegulatoryDocumentReader
{
  private readonly logger = new Logger(KsefInvoicingAdapter.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IKsefHttpClient,
    private readonly sessionCrypto: KsefSessionCryptoService,
    private readonly fa3Builder: IFa3XmlBuilder,
    private readonly seller: SellerProfile,
    /** Injected clock so the adapter (and its FA(3) timestamps) stay testable. */
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecordType> {
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

    const issuedAt = this.now();
    this.logger.log(
      `Issuing KSeF document (connection ${this.connectionId}, order ${cmd.orderId}, lines ${cmd.lines.length})`,
    );

    // 1. neutral → FA(3) (C4). Deterministic build faults throw the mapper's own
    //    typed exceptions; the service maps those to a failed record (no retry).
    const xml = this.fa3Builder.build(
      mapToFa3BuilderInput(cmd, {
        seller: this.seller,
        issueDate: this.toIsoDate(issuedAt),
        generatedAt: issuedAt.toISOString(),
        // TODO: replace the orderId placeholder with a real per-seller sequential
        // FA(3) invoice-number source (P_2 must be a unique invoice number, not an
        // order id) before prod. Owned by the core InvoiceService numbering
        // follow-up (#1118), not the C6 clearance-read (#1150).
        invoiceNumber: cmd.orderId,
      }),
    );

    // 2. Open session → encrypt → submit → close (one invoice per session).
    const cryptoContext = await this.sessionCrypto.initializeSession(issuedAt);
    const sessionRef = await this.openOnlineSession(cryptoContext);
    let invoiceReference: string;
    let submitError: unknown;
    try {
      invoiceReference = await this.submitInvoice(sessionRef, xml, cryptoContext);
    } catch (error) {
      // Track the in-flight submit error so the finally-block close can't mask
      // it: on a failed submit a subsequent close failure is logged + swallowed,
      // preserving the original (more actionable) submit error.
      submitError = error;
      throw error;
    } finally {
      try {
        await this.closeSession(sessionRef);
      } catch (closeError) {
        if (submitError === undefined) {
          // Submit succeeded — a close failure is the real (and only) error, so
          // surface it rather than silently dropping it.
          throw closeError;
        }
        this.logger.warn(
          `KSeF session close failed after a failed submit (session ref ${sessionRef}); ` +
            `keeping the original submit error. Close error: ${this.describeError(closeError)}`,
        );
      }
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
    return new InvoiceRecord(
      '', // persistence id is assigned by the core InvoiceService (#1118), not here.
      cmd.connectionId,
      cmd.orderId,
      'ksef',
      this.resolveDocumentType(cmd.documentType),
      'issued',
      encodeProviderInvoiceId(sessionRef, invoiceReference),
      null,
      'submitted',
      null,
      cmd.idempotencyKey ?? null,
      null,
      issuedAt,
      null,
      issuedAt,
      issuedAt,
    );
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
   * `RegulatoryDocumentReader.getUpo` (#1224 / C15) — fetch the UPO confirmation
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
  async getUpo(record: InvoiceRecordType): Promise<RegulatoryDocument> {
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
    // Zero-valid terminal failure: a session that KSeF has *processed* yet cleared
    // *zero* invoices is the terminal failure for this synchronous path — there is
    // nothing to reconcile later. `noSuccesses` already folds an absent count to 0,
    // so the failed-count / strict-zero qualifiers were redundant (when noSuccesses
    // holds, successfulInvoiceCount === 0 always coalesces true).
    //
    // ASSUMPTION (TODO confirm before prod): we gate "processed" on the session
    // status code === KSEF_STATUS_SUCCESS (200). The KSeF v2 OpenAPI documents 200
    // as the success/terminal code on the analogous auth-session status, but does
    // NOT publish a dedicated online-document-session status-code catalogue, so we
    // cannot definitively confirm the session-PROCESSED terminal code differs from
    // the per-invoice 200. If a distinct session-PROCESSED code surfaces in the
    // CIRFMF catalogue, introduce a `KSEF_SESSION_PROCESSED` constant and gate on
    // it here instead of reusing `KSEF_STATUS_SUCCESS`. We deliberately do NOT
    // guess a new number.
    const processed = status?.code === KSEF_STATUS_SUCCESS;
    const noSuccesses = (successfulInvoiceCount ?? 0) === 0;
    if (processed && noSuccesses) {
      throw new KsefSessionException(
        `KSeF session processed with zero valid invoices (successful ${successfulInvoiceCount ?? 0}, failed ${failedInvoiceCount ?? 0})`,
        status?.code,
        sessionRef,
      );
    }
    // Any processed session without the zero-valid count signature is
    // intentionally treated as "submitted, reconcile later": the KSeF number is
    // assigned asynchronously, so the cleared status (and a count-based accept
    // gate) is C6's concern, not this synchronous issuance path's.
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
