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
  BankAccountDefaultSetter,
  BankAccountsReader,
  CorrectionIssuer,
  DocumentType,
  GetInvoiceQuery,
  InvoicingBankAccount,
  InvoicingPort,
  IssueCorrectionCommand,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  RegulatoryClearanceResult,
  RegulatoryStatusReader,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord } from '@openlinker/core/invoicing';
import type { BridgeIssueInvoiceRequest } from '../../bridge/subiekt-bridge.types';
import type { SubiektBridgeClient } from '../../bridge/subiekt-bridge.client';
import type {
  SubiektConnectionConfig,
  SubiektPaymentMethod,
} from '../../domain/types/subiekt-connection-config.types';
import type {
  SubiektBankAccountView,
  SubiektCashRegisterView,
} from '../../domain/types/subiekt-invoicing-views.types';
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
 * Neutral document types the correction path accepts. A correction is always a
 * `credit-note` / `corrected` (faktura korygująca); any other doctype is a
 * terminal rejection — mirroring the issue path's NIP-doctype strictness. Typed
 * as `readonly string[]` so the open-world (`string`) command doctype can be
 * membership-tested without a cast.
 */
const SUPPORTED_CORRECTION_DOCUMENT_TYPES: readonly string[] = ['credit-note', 'corrected'];

/**
 * Read the retryability phase from a caught unreachable error, defaulting to the
 * fiscal-safe `'indeterminate'` for a phase-less error (e.g. the in-memory fake).
 */
function readRetryability(error: SubiektBridgeUnreachableError): SubiektTransportRetryability {
  const phase = (error as { retryability?: unknown }).retryability;
  return phase === 'safe' || phase === 'indeterminate' ? phase : 'indeterminate';
}

export class SubiektInvoicingAdapter
  implements
    InvoicingPort,
    RegulatoryStatusReader,
    CorrectionIssuer,
    BankAccountsReader,
    BankAccountDefaultSetter
{
  /**
   * Connection-level defaults (#1324). All OPTIONAL — an unset field means the
   * adapter sends nothing for it (the true additive/no-regression path); it is
   * NOT defaulted to `'cash'`. `paymentFields()`/`cashRegisterFields()` enforce
   * the fiscal-safe omission rules the bridge would otherwise 422 on. There is
   * no Oddział (branch) default: the Sfera session binds the branch read-only to
   * the logged-in bridge session, so a per-request override is impossible.
   */
  private readonly paymentMethod?: SubiektPaymentMethod;
  private readonly bankAccountId?: number;
  private readonly stanowiskoKasoweId?: number;

  constructor(
    private readonly bridge: SubiektBridgeClient,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
    // Only the optional defaults are read here; `bridgeBaseUrl`/`timeoutMs`
    // are the HTTP client's concern — accept a `Partial` so the `= {}` default
    // keeps the existing 3-arg call sites (tests) working without a cast.
    config: Partial<SubiektConnectionConfig> = {},
  ) {
    this.paymentMethod = config.defaultPaymentMethod;
    this.bankAccountId = config.bankAccountId;
    this.stanowiskoKasoweId = config.defaultStanowiskoKasoweId;
  }

  /**
   * Issue a fiscal document. Derives the neutral doctype (NIP rule) when absent,
   * maps neutral -> bridge-native, passes `idempotencyKey`, and on success builds
   * a transient issued `InvoiceRecord`. A correction doctype (`credit-note` /
   * `corrected`, #1229) is NOT issuable here — `toBridgeDocumentType` throws
   * `SubiektUnsupportedDocumentTypeError` for it; corrections go through the
   * dedicated `issueCorrection` capability.
   */
  async issueInvoice(cmd: IssueInvoiceCommand): Promise<IssueInvoiceResult> {
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
        // Connection-level payment + cash-register selection (#1324). Both
        // helpers return `{}` when unset (or when a combination the bridge would
        // 422 is only half-configured), so an unconfigured connection produces a
        // request byte-identical to the pre-#1324 behavior.
        ...this.paymentFields(),
        ...this.cashRegisterFields(),
      });

      if (response.state === 'failed') {
        // Bridge reached Subiekt but the document was not issued — terminal.
        throw new SubiektInvoiceRejectedError(
          `Subiekt returned a failed issuance for order ${cmd.orderId}`,
        );
      }

      const now = new Date();
      const record = new InvoiceRecord(
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
      // Subiekt does not surface a seller identity or a source document
      // (the bridge is a local adapter with no authority submission).
      return { record };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Issue a correction document (faktura korygująca) against an already-issued
   * original (#1229). Maps the neutral `IssueCorrectionCommand` to the real bridge
   * korekta contract (`POST /api/invoices/{origId}/corrections`): the corrected
   * original is identified by its numeric id (parsed from
   * `originalProviderInvoiceId`), the body carries `przyczyna`, the
   * `idempotencyKey` (so a retried correction returns the SAME document instead
   * of issuing a duplicate korekta — the bridge honours it in lockstep, #1229),
   * and the per-line `{ lp, nowaIlosc?, nowaCena? }` korekta lines. We also echo
   * the key onto the returned record.
   *
   * The korekta response carries NO `regulatoryStatus` — the KSeF status of a
   * correction is read back later via `RegulatoryStatusReader` (#1230), so we
   * default the record's `regulatoryStatus` to the non-terminal `'submitted'`.
   *
   * `documentType` is clamped to `credit-note` / `corrected` (mirroring the issue
   * path's strictness) — any other explicit doctype is a terminal
   * `SubiektUnsupportedDocumentTypeError`; absent defaults to `'corrected'`.
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
    if (!SUPPORTED_CORRECTION_DOCUMENT_TYPES.includes(documentType)) {
      // Clamp to the correction doctypes — a correction is never an invoice /
      // receipt / proforma. Mirrors the issue path's doctype strictness.
      throw new SubiektUnsupportedDocumentTypeError(documentType);
    }

    try {
      const response = await this.bridge.issueCorrection(origId, {
        ...(cmd.reason !== undefined ? { przyczyna: cmd.reason } : {}),
        // Place idempotencyKey on the request BEFORE the call so fiscal dedup
        // holds: a retried correction returns the SAME document.
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
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
      if (status.state === 'failed' || status.regulatoryStatus === 'none') {
        // The bridge has no live record for a providerInvoiceId we believe was
        // issued — a genuinely-missing document. Surface it so the #1121
        // reconcile doesn't silently drop it (the neutral result is still
        // 'not-applicable' so the caller treats it as no-op data, not an error).
        this.logger.warn('Subiekt bridge has no record for providerInvoiceId', {
          connectionId: this.connectionId,
          recordId: record.id,
          providerInvoiceId: record.providerInvoiceId,
        });
      }
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

  /**
   * List the seller's bank accounts as the NEUTRAL `InvoicingBankAccount[]`
   * (the generic `BankAccountsReader` core-capability seam consumed by the
   * capability-generic API surface, #1324). Deliberately DROPS the bridge's
   * `ownerPodmiotId`/`ownerName` — the neutral core type has no owner concept
   * (it is shared with inFakt/KSeF, which have no multi-Podmiot install), so
   * surfacing owner data here would leak Subiekt-specific vocabulary into
   * `libs/core`. Owner-aware consumers use `listBankAccountsWithOwner` instead.
   */
  async listBankAccounts(): Promise<InvoicingBankAccount[]> {
    try {
      const response = await this.bridge.listBankAccounts();
      return response.accounts.map((a) => ({
        id: String(a.id),
        accountNumber: a.number ?? '',
        bankName: a.name ?? '',
        isDefault: a.isDefault,
      }));
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /** Mark `accountId` as the seller's default bank account with the provider. */
  async setDefaultBankAccount(accountId: string): Promise<void> {
    // Guard the string→int coercion: a non-numeric id would otherwise POST to
    // `/api/bank-accounts/NaN/default`. Fail with the config domain error instead.
    const numericId = Number(accountId);
    if (!Number.isInteger(numericId) || numericId < 1) {
      throw new SubiektConfigException(
        'bank account id must be a positive integer',
        'accountId',
        accountId,
      );
    }
    try {
      await this.bridge.setDefaultBankAccount(numericId);
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Owner-aware bank-account variant (Subiekt-local, NOT a core capability,
   * #1324 decision 6). Returns the full bridge shape incl. `ownerPodmiotId`/
   * `ownerName` so the Subiekt-specific controller/FE can group accounts by
   * payer and render the >1-owner payer-routing warning. Not exposed on the
   * neutral `BankAccountsReader` surface.
   */
  async listBankAccountsWithOwner(): Promise<SubiektBankAccountView[]> {
    try {
      const response = await this.bridge.listBankAccounts();
      return response.accounts.map((a) => ({
        id: String(a.id),
        accountNumber: a.number ?? '',
        bankName: a.name ?? '',
        isDefault: a.isDefault,
        ownerPodmiotId: a.ownerPodmiotId,
        ownerName: a.ownerName,
      }));
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * List the seller's Stanowiska Kasowe (cash registers) — Subiekt-local, no
   * core capability (#1324 decision 2). Mapped 1:1 from the bridge; `oddzialId`
   * stays `number | null` (`null` = unlinked register; a non-null value is the
   * register's informational branch tag, a display label only).
   */
  async listCashRegisters(): Promise<SubiektCashRegisterView[]> {
    try {
      const response = await this.bridge.listCashRegisters();
      return response.cashRegisters.map((c) => ({
        id: c.id,
        name: c.name,
        symbol: c.symbol,
        oddzialId: c.oddzialId,
      }));
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Build the additive payment-selection fields for an issue-invoice request
   * (#1324). Fiscal-safe omission mirrors the bridge's `PaymentSelection`
   * rules so a half-configured connection never sends a request the bridge
   * would 422:
   *   - no `paymentMethod` configured        -> `{}` (send nothing; legacy path)
   *   - `transfer` without a `bankAccountId`  -> `{}` (never send an incomplete transfer)
   *   - `transfer` with a `bankAccountId`     -> `{ paymentMethod: 'transfer', bankAccountId }`
   *   - `cash`                                -> `{ paymentMethod: 'cash' }`
   */
  private paymentFields(): Partial<
    Pick<BridgeIssueInvoiceRequest, 'paymentMethod' | 'bankAccountId'>
  > {
    if (!this.paymentMethod) {
      return {};
    }
    if (this.paymentMethod === 'transfer') {
      if (this.bankAccountId === undefined) {
        // Observable misconfiguration: nothing prevents saving `transfer` with
        // no bank account, and the omission silently downgrades to the bridge
        // default. Warn so the half-configured state is visible in logs.
        this.logger.warn(
          'Subiekt connection is configured for transfer payment but has no bankAccountId; omitting payment fields (bridge default applies)',
          { connectionId: this.connectionId },
        );
        return {};
      }
      return { paymentMethod: 'transfer', bankAccountId: this.bankAccountId };
    }
    return { paymentMethod: 'cash' };
  }

  /**
   * Build the additive cash-register field for an issue-invoice request (#1324).
   * The Oddział (branch) axis was cut: the Sfera session binds the branch
   * read-only to the logged-in bridge session, so `stanowiskoKasoweId` is the
   * only real per-document routing field.
   *   - `stanowiskoKasoweId` configured -> `{ stanowiskoKasoweId }`;
   *   - unset                           -> `{}` (legacy path).
   */
  private cashRegisterFields(): Partial<Pick<BridgeIssueInvoiceRequest, 'stanowiskoKasoweId'>> {
    return this.stanowiskoKasoweId !== undefined
      ? { stanowiskoKasoweId: this.stanowiskoKasoweId }
      : {};
  }

  /** Neutral document types this provider issues. */
  getSupportedDocumentTypes(): DocumentType[] {
    return [...SUPPORTED_DOCUMENT_TYPES];
  }
}
