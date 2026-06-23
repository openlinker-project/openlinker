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
 *   4. Session status `445` (closed with zero valid invoices) → throw
 *      `KsefSessionException` (a terminal business failure, never a success).
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
  ClearanceResult,
  ClearanceStatus,
  DocumentType,
  GetInvoiceQuery,
  InvoiceRecord as InvoiceRecordType,
  InvoicingPort,
  IssueInvoiceCommand,
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
  FA3_NAMESPACE,
  FA3_SCHEMA_VERSION,
} from '../fa3/domain/fa3-xml.types';
import { mapToFa3BuilderInput } from '../fa3/domain/fa3-builder-input.mapper';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefSessionException } from '../../domain/exceptions/ksef-session.exception';
import {
  KSEF_NUMBER_PATTERN,
  KSEF_SESSION_CLOSED_ZERO_VALID,
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

export class KsefInvoicingAdapter implements InvoicingPort, RegulatoryTransmitter {
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
        invoiceNumber: cmd.orderId,
      }),
    );

    // 2. Open session → encrypt → submit → close (one invoice per session).
    const cryptoContext = await this.sessionCrypto.initializeSession(issuedAt);
    const sessionRef = await this.openOnlineSession(cryptoContext);
    let invoiceReference: string;
    try {
      invoiceReference = await this.submitInvoice(sessionRef, xml, cryptoContext);
    } finally {
      await this.closeSession(sessionRef);
    }

    // 3. KSeF rejects-with-zero-valid is reported on the session status, not the
    //    submit POST — read it so a 445 is a loud failure, not a false success.
    await this.assertSessionAccepted(sessionRef);

    this.logger.log(
      `KSeF document submitted (connection ${this.connectionId}, invoice ref ${invoiceReference})`,
    );

    // 4. Neutral result. KSeF number is async (C6 reconciles) → clearanceReference null.
    return new InvoiceRecord(
      '', // persistence id is assigned by the core InvoiceService (#1118), not here.
      cmd.connectionId,
      cmd.orderId,
      'ksef',
      this.resolveDocumentType(cmd.documentType),
      'issued',
      invoiceReference,
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
  submitForClearance(record: InvoiceRecordType): Promise<ClearanceResult> {
    return Promise.resolve({
      regulatoryStatus: record.regulatoryStatus === 'not-applicable' ? 'submitted' : record.regulatoryStatus,
      clearanceReference: record.clearanceReference,
    });
  }

  /**
   * Read the current clearance status by polling KSeF (#1150 / C6).
   *
   * Resolves the invoice reference (the session-scoped `referenceNumber` C5
   * persisted as `providerInvoiceId`) or an already-assigned KSeF number, reads
   * the per-invoice status, maps the KSeF status code → neutral `RegulatoryStatus`,
   * and on success captures the 35-char KSeF number as the opaque
   * `clearanceReference`. The UPO document pointer is fetched for traceability but
   * does NOT ride back on C1's neutral shape (see {@link buildClearedStatus}). A
   * `5xx` from KSeF propagates as a
   * thrown transport exception (transient — the #1121 job retries); a terminal
   * business status is returned as a `rejected` read result, not thrown.
   */
  async getClearanceStatus(reference: string | InvoiceRecordType): Promise<ClearanceStatus> {
    const invoiceRef = this.resolveInvoiceReference(reference);
    this.logger.log(
      `Reading KSeF clearance status (connection ${this.connectionId}, invoice ref ${invoiceRef})`,
    );

    const response = await this.httpClient.get<InvoiceStatusResponse>(
      `/invoices/${encodeURIComponent(invoiceRef)}`,
    );
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
      // 5xx transient — surface as a retryable transport failure for #1121.
      throw new KsefApiException(
        `KSeF invoice status read returned transient status ${code}`,
        code,
        undefined,
        `/invoices/${invoiceRef}`,
      );
    }

    if (regulatoryStatus !== 'accepted') {
      // Non-terminal (submitted) or terminal-failure (rejected): no KSeF number yet.
      return { regulatoryStatus, clearanceReference: null };
    }

    return this.buildClearedStatus(response.data, invoiceRef);
  }

  /**
   * On a cleared invoice, capture the KSeF number (validated against the 35-char
   * pattern) as the neutral `clearanceReference`, and fetch the UPO pointer.
   *
   * UPO LANDING (#1150 reconciliation note): C1's `ClearanceStatus` shape is
   * strictly `{ regulatoryStatus, clearanceReference }` — it has NO `pdfUrl`/
   * document-reference field, and ADR-026 forbids widening the neutral outcome
   * with a `ksef`/`upo` string. So the UPO reference cannot ride back on the
   * return value; we fetch it (confirming availability) and log a stable pointer
   * for traceability. C8 (UPO download) resolves the UPO document from the
   * `clearanceReference` (KSeF number) the record already carries — the KSeF
   * number is the stable key into the UPO endpoint
   * (`/invoices/ksef/{ksefNumber}/upo`), so no extra field is needed.
   */
  private async buildClearedStatus(
    data: InvoiceStatusResponse,
    invoiceRef: string,
  ): Promise<ClearanceStatus> {
    const ksefNumber = data.ksefReferenceNumber;
    if (!ksefNumber || !KSEF_NUMBER_PATTERN.test(ksefNumber)) {
      throw new KsefSessionException(
        `KSeF reported success (status ${KSEF_STATUS_SUCCESS}) without a valid KSeF number`,
        KSEF_STATUS_SUCCESS,
        invoiceRef,
      );
    }

    const upoReference = await this.resolveUpoReference(data, ksefNumber);
    if (upoReference) {
      this.logger.log(
        `KSeF clearance accepted (connection ${this.connectionId}); UPO available at ${upoReference}`,
      );
    }

    return { regulatoryStatus: 'accepted', clearanceReference: ksefNumber };
  }

  /**
   * Resolve a stable UPO document pointer for a cleared invoice. Prefers the
   * pointer KSeF already returned on the status payload; otherwise reads the UPO
   * metadata endpoint by KSeF number. Best-effort — a UPO read failure does NOT
   * fail the clearance read (the document cleared regardless), so a transient UPO
   * fetch error is swallowed and the #1121 job re-resolves it next tick.
   *
   * PROVISIONAL endpoints (`/invoices/ksef/{ksefNumber}/upo`) and field names —
   * best-reading of KSeF 2.0; reconcile against live docs (same posture as C4/C5).
   */
  private async resolveUpoReference(
    data: InvoiceStatusResponse,
    ksefNumber: string,
  ): Promise<string | null> {
    const fromStatus = data.upo?.downloadUrl ?? data.upo?.referenceNumber ?? null;
    if (fromStatus) {
      return fromStatus;
    }
    try {
      const upo = await this.httpClient.get<{ referenceNumber?: string; downloadUrl?: string }>(
        `/invoices/ksef/${encodeURIComponent(ksefNumber)}/upo`,
      );
      return upo.data.downloadUrl ?? upo.data.referenceNumber ?? null;
    } catch (error) {
      this.logger.warn(
        `KSeF UPO pointer fetch failed for a cleared invoice (connection ${this.connectionId}): ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Resolve the KSeF identifier to poll. An `InvoiceRecord` carries the
   * session-scoped invoice reference C5 persisted as `providerInvoiceId`; a bare
   * string is taken as that reference directly (the reconciliation job passes
   * whichever it holds).
   */
  private resolveInvoiceReference(reference: string | InvoiceRecordType): string {
    const invoiceRef = typeof reference === 'string' ? reference : reference.providerInvoiceId;
    if (!invoiceRef) {
      throw new KsefSessionException(
        'Cannot read KSeF clearance status: no invoice reference on the record',
      );
    }
    return invoiceRef;
  }

  private async openOnlineSession(context: SessionCryptoContext): Promise<string> {
    const body: OpenOnlineSessionRequest = {
      formCode: {
        systemCode: FA3_NAMESPACE,
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
    const response = await this.httpClient.get<OnlineSessionStatusResponse>(
      `/sessions/online/${encodeURIComponent(sessionRef)}`,
    );
    const code = response.data.status?.code;
    if (code === KSEF_SESSION_CLOSED_ZERO_VALID) {
      throw new KsefSessionException(
        `KSeF session closed with zero valid invoices (status ${code})`,
        code,
        sessionRef,
      );
    }
  }

  private resolveDocumentType(documentType?: string): string {
    // The command's neutral type passes through; KSeF defaults to a plain invoice.
    return documentType && documentType.length > 0 ? documentType : 'invoice';
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
