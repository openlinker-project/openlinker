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
import { KSEF_BRAND } from '../../ksef.constants';
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
import { encodeProviderInvoiceId } from './ksef-provider-invoice-id';
import { KsefSessionException } from '../../domain/exceptions/ksef-session.exception';
import { KsefUnsupportedDocumentTypeException } from '../../domain/exceptions/ksef-unsupported-document-type.exception';
import {
  KSEF_SESSION_CLOSED_ZERO_VALID,
  type OnlineSessionStatusResponse,
  type OpenOnlineSessionRequest,
  type OpenOnlineSessionResponse,
  type SendInvoiceRequest,
  type SendInvoiceResponse,
} from './ksef-session.types';

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
    // `DocumentType` is open-world at the core boundary (#576); KSeF issues only
    // the subset getSupportedDocumentTypes advertises. Reject anything else up
    // front with a terminal exception so the service marks the record failed
    // rather than the adapter emitting a wrong document downstream.
    this.assertDocumentTypeSupported(cmd.documentType);

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
        // TODO(#1150): replace the orderId placeholder with a real sequential
        // FA(3) invoice-number source before prod.
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
    //    submit POST — read it so a 445 is a loud failure, not a false success.
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
   * `RegulatoryTransmitter.submitForClearance` — clearance polling lands in C6.
   * Declared so `isRegulatoryTransmitter(adapter)` returns true (the adapter IS a
   * clearance provider); the live status read is wired in the follow-up issue.
   */
  submitForClearance(_record: InvoiceRecordType): Promise<ClearanceResult> {
    return Promise.reject(this.clearanceNotYetWired('submitForClearance'));
  }

  getClearanceStatus(_reference: string | InvoiceRecordType): Promise<ClearanceStatus> {
    return Promise.reject(this.clearanceNotYetWired('getClearanceStatus'));
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
    const code = response.data.status?.code;
    if (code === KSEF_SESSION_CLOSED_ZERO_VALID) {
      throw new KsefSessionException(
        `KSeF session closed with zero valid invoices (status ${code})`,
        code,
        sessionRef,
      );
    }
    // Any non-445 code immediately post-close is intentionally treated as
    // "submitted, reconcile later": the KSeF number is assigned asynchronously,
    // so the cleared status (and a count-based accept gate) is C6's concern, not
    // this synchronous issuance path's.
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

  private clearanceNotYetWired(method: string): Error {
    return new Error(
      `${KSEF_BRAND} ${method} (clearance status read) lands in C6 (connection ${this.connectionId}).`,
    );
  }
}
