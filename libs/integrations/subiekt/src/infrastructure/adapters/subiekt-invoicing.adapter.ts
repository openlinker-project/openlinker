/**
 * Subiekt Invoicing Adapter (#753)
 *
 * Implements the core `InvoicingPort` over a `SubiektBridgeClient`. This is the
 * Subiekt/PL-specific layer: it OWNS the NIP -> faktura/paragon doctype mechanic
 * and maps neutral <-> bridge-native shapes. It does NOT decide whether/when a
 * document is issued (that policy lives above the port) and holds NO repository
 * — `issueInvoice` returns a TRANSIENT `InvoiceRecord`; the core InvoiceService
 * persists.
 *
 * Error translation:
 *   - bridge `SubiektRejectedError`        -> `SubiektInvoiceRejectedError` (terminal)
 *   - bridge 2xx with `state: 'failed'`    -> `SubiektInvoiceRejectedError` (terminal)
 *   - bridge `SubiektBridgeUnreachableError` -> `SubiektBridgeTransportError`.
 *     Reads `retryability` when the caught error is the phase-carrying subclass
 *     (`SubiektBridgeUnreachableWithPhaseError`); otherwise DEFAULTS to
 *     `'indeterminate'` (the fiscal-safe default — the branch the fake exercises).
 *   - recognised terminal Subiekt errors (`SubiektBridgeAuthError`,
 *     `SubiektUnsupportedDocumentTypeError`, `SubiektConfigException`) pass through.
 *   - any genuinely-UNKNOWN throwable -> a Subiekt-typed `'indeterminate'`
 *     `SubiektBridgeTransportError` (original preserved as `cause`). Keeps the
 *     fiscal-safe "unknown -> non-retryable" intent LOCAL to Subiekt so the
 *     retry classifier needs no global catch-all that would mis-classify sibling
 *     plugins' errors.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */
import { randomUUID } from 'crypto';
import type { LoggerPort } from '@openlinker/shared/logging';
import type {
  DocumentType,
  GetInvoiceQuery,
  InvoicingPort,
  IssueInvoiceCommand,
  RegulatoryClearanceResult,
  RegulatoryStatusReader,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type { SubiektBridgeClient } from '../../bridge/subiekt-bridge.client';
import {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from '../../bridge/subiekt-bridge.errors';
import { SubiektBridgeTransportError } from '../../domain/exceptions/subiekt-bridge-transport.exception';
import type { SubiektTransportRetryability } from '../../domain/types/subiekt-transport-retryability.types';
import { SubiektInvoiceRejectedError } from '../../domain/exceptions/subiekt-invoice-rejected.exception';
import { SubiektBridgeAuthError } from '../../domain/exceptions/subiekt-bridge-auth.exception';
import { SubiektUnsupportedDocumentTypeError } from '../../domain/exceptions/subiekt-unsupported-document-type.exception';
import { SubiektConfigException } from '../../domain/exceptions/subiekt-config.exception';
import {
  deriveNeutralDocumentType,
  isCorrectionDocumentType,
  toBridgeCorrectionDocumentType,
  toBridgeDocumentType,
} from '../mappers/subiekt-document-type.mapper';
import { toBridgeBuyer } from '../mappers/subiekt-buyer.mapper';
import { toBridgeUpsertCustomerRequest } from '../mappers/subiekt-customer.mapper';
import { toBridgeLines } from '../mappers/subiekt-line.mapper';
import { toNeutralRegulatoryStatus } from '../mappers/subiekt-regulatory-status.mapper';

/** Provider identifier stamped onto returned `InvoiceRecord`s. */
export const SUBIEKT_PROVIDER_TYPE = 'subiekt';

/**
 * Neutral document types this provider issues. `credit-note` / `corrected` (#1229)
 * are issued through the bridge correction endpoint (faktura korygująca); the rest
 * through the plain issue path.
 */
const SUPPORTED_DOCUMENT_TYPES: readonly DocumentType[] = [
  'invoice',
  'receipt',
  'credit-note',
  'corrected',
];

/**
 * Read the retryability phase from a caught unreachable error, defaulting to the
 * fiscal-safe `'indeterminate'` for a phase-less error (e.g. the in-memory fake).
 */
function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

export class SubiektInvoicingAdapter implements InvoicingPort, RegulatoryStatusReader {
  constructor(
    private readonly bridge: SubiektBridgeClient,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Issue a fiscal document. Derives the neutral doctype (NIP rule) when absent,
   * maps neutral -> bridge-native, passes `idempotencyKey`, and on success builds
   * a transient issued `InvoiceRecord`. A correction doctype (`credit-note` /
   * `corrected`, #1229) is routed to the bridge correction endpoint instead.
   */
  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    // OWN the NIP -> faktura/paragon mechanic: derive the NEUTRAL doctype then
    // map it to the bridge-native string. Core never sees faktura/paragon/NIP.
    const neutralDocumentType = deriveNeutralDocumentType(cmd.buyer, cmd.documentType);

    // A correction document (faktura korygująca) goes through the dedicated
    // correction endpoint — never the plain issue path (#1229).
    if (isCorrectionDocumentType(neutralDocumentType)) {
      return this.issueCorrection(cmd, neutralDocumentType);
    }

    const bridgeDocumentType = toBridgeDocumentType(neutralDocumentType);

    const idempotencyKey = cmd.idempotencyKey;

    try {
      const response = await this.bridge.issueInvoice({
        documentType: bridgeDocumentType,
        currency: cmd.currency,
        orderId: cmd.orderId,
        // Place idempotencyKey on the request BEFORE the call so fiscal dedup
        // holds on every error branch.
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        // Self-sufficient mode: the buyer is carried INLINE (no kontrahentId);
        // the bridge auto-upserts it and bills it in one unit of work.
        buyer: toBridgeBuyer(cmd.buyer),
        lines: toBridgeLines(cmd.lines),
      });

      if (response.state === 'failed') {
        // Bridge reached Subiekt but the document was not issued — terminal.
        throw new SubiektInvoiceRejectedError(
          `Subiekt returned a failed issuance for order ${cmd.orderId}`,
        );
      }

      const now = new Date();
      return new InvoiceRecord(
        // Transient id — the core InvoiceService persists and may overwrite it.
        randomUUID(),
        this.connectionId,
        cmd.orderId,
        SUBIEKT_PROVIDER_TYPE,
        // NEUTRAL document type — never the bridge-native faktura/paragon.
        neutralDocumentType,
        'issued',
        // The bridge returns a numeric Subiekt document id; the neutral
        // InvoiceRecord carries provider ids as strings.
        String(response.providerInvoiceId),
        response.providerInvoiceNumber,
        toNeutralRegulatoryStatus(response.regulatoryStatus),
        // clearanceReference — populated by a future RegulatoryTransmitter.
        null,
        idempotencyKey ?? null,
        response.pdfUrl,
        now,
        // errorMessage
        null,
        now,
        now,
      );
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Issue a correction document (faktura korygująca) for an order, against its
   * already-issued original (#1229). The neutral command carries only `orderId`,
   * not the original provider id, so the bridge resolves the original from
   * `orderId` (`originalProviderInvoiceId` is left for the future-id-carrying
   * caller). Maps neutral correction doctype -> bridge-native `FK`, places the
   * `idempotencyKey` BEFORE the call (fiscal dedup), and on success builds a
   * transient issued `InvoiceRecord` carrying the ORIGINAL neutral correction
   * doctype (`credit-note` / `corrected`).
   *
   * EXTERNAL DEPENDENCY: the live bridge correction endpoint is
   * openlinker-subiekt#6 — not yet implemented. The adapter codes against the
   * frozen `SubiektBridgeClient.issueCorrection` contract; the fake models it.
   */
  private async issueCorrection(
    cmd: IssueInvoiceCommand,
    neutralDocumentType: DocumentType,
  ): Promise<InvoiceRecord> {
    const bridgeDocumentType = toBridgeCorrectionDocumentType(neutralDocumentType);
    const idempotencyKey = cmd.idempotencyKey;

    try {
      const response = await this.bridge.issueCorrection({
        documentType: bridgeDocumentType,
        currency: cmd.currency,
        orderId: cmd.orderId,
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        buyer: toBridgeBuyer(cmd.buyer),
        lines: toBridgeLines(cmd.lines),
      });

      if (response.state === 'failed') {
        throw new SubiektInvoiceRejectedError(
          `Subiekt returned a failed correction issuance for order ${cmd.orderId}`,
        );
      }

      const now = new Date();
      return new InvoiceRecord(
        randomUUID(),
        this.connectionId,
        cmd.orderId,
        SUBIEKT_PROVIDER_TYPE,
        // Preserve the caller's neutral correction doctype (credit-note/corrected).
        neutralDocumentType,
        'issued',
        String(response.providerInvoiceId),
        response.providerInvoiceNumber,
        toNeutralRegulatoryStatus(response.regulatoryStatus),
        null,
        idempotencyKey ?? null,
        response.pdfUrl,
        now,
        null,
        now,
        now,
      );
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Read the live regulatory (KSeF) clearance status of an already-issued
   * document (#1230). Subiekt transmits to KSeF natively at issuance; OL only
   * READS the resulting status here (it implements `RegulatoryStatusReader`, NOT
   * `RegulatoryTransmitter`). Resolves the neutral `RegulatoryClearanceResult`
   * from the bridge status read keyed by the record's `providerInvoiceId`. A
   * record with no `providerInvoiceId` cannot be read back — return
   * `not-applicable` (no transport call). A transport failure throws (translated)
   * for the caller to retry; a business verdict (incl. `rejected`) returns as data.
   */
  async getClearanceStatus(record: InvoiceRecord): Promise<RegulatoryClearanceResult> {
    if (record.providerInvoiceId === null || record.providerInvoiceId.length === 0) {
      this.logger.debug(
        'Subiekt getClearanceStatus called for a record without a providerInvoiceId; returning not-applicable',
        { connectionId: this.connectionId, recordId: record.id },
      );
      return { regulatoryStatus: 'not-applicable', clearanceReference: null };
    }

    try {
      const status = await this.bridge.getInvoiceStatus({
        providerInvoiceId: record.providerInvoiceId,
      });
      return {
        regulatoryStatus: toNeutralRegulatoryStatus(status.regulatoryStatus),
        // The bridge status read carries no authority reference today; preserve
        // any reference already captured on the record.
        clearanceReference: record.clearanceReference,
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Translate bridge / domain errors:
   *   - `SubiektInvoiceRejectedError` (raised above) passes through.
   *   - `SubiektRejectedError`        -> `SubiektInvoiceRejectedError` (terminal).
   *   - `SubiektBridgeUnreachableError` -> `SubiektBridgeTransportError`,
   *     carrying the retryability phase (defaulting to `'indeterminate'`).
   *   - other recognised Subiekt-owned terminal errors (`SubiektBridgeAuthError`,
   *     `SubiektUnsupportedDocumentTypeError`, `SubiektConfigException`) pass
   *     through unchanged so the retry classifier sees their concrete type.
   *   - a genuinely-UNKNOWN throwable is wrapped into a Subiekt-typed
   *     `'indeterminate'` `SubiektBridgeTransportError`. We cannot prove the POST
   *     never reached Subiekt, so this keeps the fiscal-safe "unknown ->
   *     non-retryable" intent LOCAL to the Subiekt path — the retry classifier
   *     no longer needs a global catch-all that would wrongly mark sibling
   *     plugins' errors non-retryable.
   */
  private translateBridgeError(error: unknown): Error {
    if (error instanceof SubiektInvoiceRejectedError) {
      return error;
    }
    if (error instanceof SubiektRejectedError) {
      return new SubiektInvoiceRejectedError(error.reason);
    }
    if (error instanceof SubiektBridgeUnreachableError) {
      return new SubiektBridgeTransportError(error.message, readRetryability(error));
    }
    if (
      error instanceof SubiektBridgeAuthError ||
      error instanceof SubiektUnsupportedDocumentTypeError ||
      error instanceof SubiektConfigException
    ) {
      return error;
    }
    return new SubiektBridgeTransportError(
      error instanceof Error ? error.message : 'Unknown Subiekt bridge error',
      'indeterminate',
      { cause: error },
    );
  }

  /**
   * Fetch an issued document. Returns `null` for BOTH branches in #753:
   *   - `{orderId}`: the bridge has no order-keyed read.
   *   - `{providerInvoiceId}`: `getInvoiceStatus` returns only `{state,
   *     regulatoryStatus}` — it cannot supply the non-nullable `orderId` /
   *     `documentType` an `InvoiceRecord` requires. DEBUG-log that the document
   *     may exist but cannot be projected (a designed, expected no-op — not a
   *     warning); do NOT call `bridge.getInvoiceStatus`.
   *
   * TODO(#752/core): existence checks for Subiekt MUST NOT rely on `getInvoice`
   * until core defines how to backfill `orderId` / `documentType` for a
   * status-only projection.
   */
  getInvoice(_query: GetInvoiceQuery): Promise<InvoiceRecord | null> {
    // Both branches return null in #753: the bridge has no order-keyed read, and
    // `getInvoiceStatus` cannot supply the non-nullable orderId/documentType an
    // InvoiceRecord requires. Do NOT call bridge.getInvoiceStatus.
    this.logger.debug(
      'Subiekt getInvoice is not projectable from the bridge; returning null without a status read',
      { connectionId: this.connectionId },
    );
    return Promise.resolve(null);
  }

  /** Create-or-update the buyer as a Subiekt customer (kontrahent). */
  async upsertCustomer(cmd: UpsertCustomerCommand): Promise<UpsertCustomerResult> {
    try {
      // The bridge's upsert body is TOP-LEVEL (nazwaSkrocona/nip/typ/...), NOT
      // wrapped in a `buyer`. It echoes back the numeric customer `id`.
      const response = await this.bridge.upsertCustomer(toBridgeUpsertCustomerRequest(cmd.buyer));
      return { providerCustomerId: String(response.id) };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /** Neutral document types this provider issues. */
  getSupportedDocumentTypes(): DocumentType[] {
    return [...SUPPORTED_DOCUMENT_TYPES];
  }
}
