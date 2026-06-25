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
  CorrectionIssuer,
  DocumentType,
  GetInvoiceQuery,
  InvoicingPort,
  IssueCorrectionCommand,
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
  toBridgeDocumentType,
} from '../mappers/subiekt-document-type.mapper';
import { toBridgeBuyer } from '../mappers/subiekt-buyer.mapper';
import { toBridgeUpsertCustomerRequest } from '../mappers/subiekt-customer.mapper';
import { toBridgeKorektaLine, toBridgeLines } from '../mappers/subiekt-line.mapper';
import { toNeutralRegulatoryStatus } from '../mappers/subiekt-regulatory-status.mapper';

/** Provider identifier stamped onto returned `InvoiceRecord`s. */
export const SUBIEKT_PROVIDER_TYPE = 'subiekt';

/**
 * Neutral document types this provider issues. `credit-note` / `corrected` (#1229)
 * are issued through the dedicated `CorrectionIssuer.issueCorrection` capability
 * (faktura korygująca); the rest through the plain `issueInvoice` path.
 */
const SUPPORTED_DOCUMENT_TYPES: readonly DocumentType[] = [
  'invoice',
  'receipt',
  'credit-note',
  'corrected',
];

/** Default neutral document type stamped on a correction record when the caller omits one. */
const DEFAULT_CORRECTION_DOCUMENT_TYPE = 'corrected';

/**
 * Read the retryability phase from a caught unreachable error, defaulting to the
 * fiscal-safe `'indeterminate'` for a phase-less error (e.g. the in-memory fake).
 */
function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

export class SubiektInvoicingAdapter
  implements InvoicingPort, RegulatoryStatusReader, CorrectionIssuer
{
  constructor(
    private readonly bridge: SubiektBridgeClient,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Issue a fiscal document. Derives the neutral doctype (NIP rule) when absent,
   * maps neutral -> bridge-native, passes `idempotencyKey`, and on success builds
   * a transient issued `InvoiceRecord`. A correction doctype (`credit-note` /
   * `corrected`, #1229) is NOT issuable here — `toBridgeDocumentType` throws
   * `SubiektUnsupportedDocumentTypeError` for it; corrections go through the
   * dedicated `issueCorrection` capability.
   */
  async issueInvoice(cmd: IssueInvoiceCommand): Promise<InvoiceRecord> {
    // OWN the NIP -> faktura/paragon mechanic: derive the NEUTRAL doctype then
    // map it to the bridge-native string. Core never sees faktura/paragon/NIP.
    // A correction doctype here is a clean rejection (corrections use the
    // dedicated capability, not the plain issue path, #1229).
    const neutralDocumentType = deriveNeutralDocumentType(cmd.buyer, cmd.documentType);
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
   * Issue a correction document (faktura korygująca) against an already-issued
   * original (#1229). Maps the neutral `IssueCorrectionCommand` to the real bridge
   * korekta contract (`POST /api/invoices/{origId}/corrections`): the corrected
   * original is identified by its numeric id (parsed from
   * `originalProviderInvoiceId`), the body carries `przyczyna` + the per-line
   * `{ lp, nowaIlosc?, nowaCena? }` korekta lines. Places the `idempotencyKey`
   * BEFORE the call is irrelevant here — the korekta body has no idempotency field
   * (gap below); we still echo it onto the returned record.
   *
   * The korekta response carries NO `regulatoryStatus` — the KSeF status of a
   * correction is read back later via `RegulatoryStatusReader` (#1230), so we
   * default the record's `regulatoryStatus` to the non-terminal `'submitted'`.
   *
   * A non-positive-integer `originalProviderInvoiceId` is a terminal, fiscal-safe
   * rejection (we cannot route the correction) — `SubiektInvoiceRejectedError`.
   */
  async issueCorrection(cmd: IssueCorrectionCommand): Promise<InvoiceRecord> {
    const origId = Number(cmd.originalProviderInvoiceId);
    if (!Number.isInteger(origId) || origId <= 0) {
      throw new SubiektInvoiceRejectedError(
        `originalProviderInvoiceId is not a positive integer Subiekt document id: ${String(
          cmd.originalProviderInvoiceId,
        )}`,
      );
    }

    const idempotencyKey = cmd.idempotencyKey;
    const documentType = cmd.documentType ?? DEFAULT_CORRECTION_DOCUMENT_TYPE;

    try {
      const response = await this.bridge.issueCorrection(origId, {
        ...(cmd.reason !== undefined ? { przyczyna: cmd.reason } : {}),
        lines: cmd.lines.map(toBridgeKorektaLine),
      });

      if (response.state === 'failed') {
        throw new SubiektInvoiceRejectedError(
          `Subiekt returned a failed correction issuance for order ${cmd.orderId}`,
        );
      }

      const now = new Date();
      return new InvoiceRecord(
        // Transient id — the core InvoiceService persists and may overwrite it.
        randomUUID(),
        this.connectionId,
        cmd.orderId,
        SUBIEKT_PROVIDER_TYPE,
        documentType,
        'issued',
        String(response.providerInvoiceId),
        response.providerInvoiceNumber,
        // The korekta response carries no regulatory status; default to the
        // non-terminal 'submitted' so the #1230 reconcile refreshes it later.
        'submitted',
        // clearanceReference — populated by a later RegulatoryStatusReader read.
        null,
        idempotencyKey ?? null,
        // The korekta response carries no pdfUrl.
        null,
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
