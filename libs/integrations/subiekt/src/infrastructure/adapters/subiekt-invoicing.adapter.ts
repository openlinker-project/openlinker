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
  WarehouseRelease,
  PaymentStatusReader,
  PaymentStatusResult,
  RegulatoryClearanceResult,
  RegulatoryLocateCriteria,
  RegulatoryLocateResult,
  RegulatoryRecordLocator,
  RegulatoryStatusReader,
  UpsertCustomerCommand,
  UpsertCustomerResult,
} from '@openlinker/core/invoicing';
import { InvoiceRecord, MissingTaxRateException } from '@openlinker/core/invoicing';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { modelIdFromProductKey } from './subiekt-model-key';
import { towarSymbolFromVariantExternalId } from './subiekt-variant-identity';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
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

/**
 * Provider identifier stamped onto returned `InvoiceRecord`s.
 *
 * `subiekt-gt`, never the bare `subiekt`: a document issued through the Sfera
 * GT bridge must be distinguishable from one the nexo adapter would
 * issue, and this value is what an operator reads on the document row.
 */
export const SUBIEKT_PROVIDER_TYPE = 'subiekt-gt';

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
    BankAccountDefaultSetter,
    RegulatoryRecordLocator,
    PaymentStatusReader
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
  /** #3365 - the release warehouse stamped on every document this adapter writes. */
  private readonly stockMagazynId?: number;

  constructor(
    private readonly bridge: SubiektBridgeClient,
    // Resolves the Subiekt ZK's numeric `dok_Id` for `issueInvoice`'s #3431
    // warehouse-release step — see `resolveZkId`. Positioned right after
    // `bridge`, mirroring `SubiektOrderProcessorAdapter`'s constructor.
    private readonly identifierMapping: IdentifierMappingPort,
    private readonly connectionId: string,
    private readonly logger: LoggerPort,
    // Only the optional defaults are read here; `bridgeBaseUrl`/`timeoutMs`
    // are the HTTP client's concern — accept a `Partial` so the `= {}` default
    // keeps the existing 4-arg call sites (tests) working without a cast.
    config: Partial<SubiektConnectionConfig> = {},
  ) {
    this.paymentMethod = config.defaultPaymentMethod;
    this.bankAccountId = config.bankAccountId;
    this.stanowiskoKasoweId = config.defaultStanowiskoKasoweId;
    this.stockMagazynId = config.stockMagazynId;
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
    // #3431 follow-up: resolve the ZK's own numeric dok_Id via
    // identifier_mappings BEFORE the call, so the bridge's warehouse-release
    // step never has to search dok_NrPelnyOryg by orderId — see `resolveZkId`.
    const zkId = await this.resolveZkId(cmd.orderId);
    // Resolve each line's Subiekt catalogue symbol so the document carries real
    // catalogue positions instead of free-text service lines — see
    // `resolveTowarSymbols` and the line mapper's header.
    const { symbolByProductId, unmappedCatalogueKeys } = await this.resolveTowarSymbols(cmd.lines);
    // Count LINES, not products: two lines of the same unmapped product are two
    // lines the warehouse will not see, and the operator is looking at a
    // document whose lines are what they can count.
    //
    // The three cases are deliberately distinct. A line with NO `productId` is
    // a shipping or hand-written line - there is no product to link, so it is
    // not a defect and is not counted. A line whose `productId` is the EMPTY
    // STRING names a product and supplies no id for it: it cannot be looked
    // up, so it goes out free-text exactly like an unmapped one, and counting
    // it is the whole point - the alternative reports it as linked while the
    // warehouse never sees it. Everything else is counted iff the lookup came
    // back with no catalogue symbol.
    const unlinkedCatalogueLines = cmd.lines.filter((line) => {
      if (line.productId === undefined) return false;
      if (line.productId === '') return true;
      // Keyed the way the resolver keys it - by variant where there is one
      // (#3365 review). A model's members share a product id, so testing the
      // product marked every sibling line unlinked as soon as one variant
      // failed to resolve.
      return unmappedCatalogueKeys.has(line.variantId ?? line.productId);
    }).length;

    try {
      const response = await this.bridge.issueInvoice({
        documentType: bridgeDocumentType,
        currency: cmd.currency,
        orderId: cmd.orderId,
        ...(zkId !== null ? { zkId } : {}),
        // #3365 - the warehouse this sale releases from. Until now NO document
        // named one: the bridge took whatever the Sfera session defaulted to
        // while `stockMagazynId` steered only the stock READ, so a
        // two-warehouse install published one warehouse's figure and shipped
        // out of another. Absent keeps the pre-#3365 behaviour exactly.
        ...(this.stockMagazynId !== undefined ? { magazynId: this.stockMagazynId } : {}),
        // Place idempotencyKey on the request BEFORE the call so fiscal dedup
        // holds on every error branch.
        ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
        // Self-sufficient mode: the buyer is carried INLINE (no kontrahentId);
        // the bridge auto-upserts it and bills it in one unit of work.
        buyer: toBridgeBuyer(cmd.buyer),
        // #2260 review: the era travels with the lines so a pre-rollout order
        // is exempt here exactly as it is on the other two invoicing routes.
        lines: toBridgeLines(cmd.lines, cmd.taxRateEra, symbolByProductId),
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
        // #3352: the bridge now puts the KSeF number on the wire at
        // issuance too (it was always read locally via ReadKsefStatus, just
        // never returned) — `null` until KSeF actually assigns one.
        response.clearanceReference,
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
      //
      // `unlinkedCatalogueLines` is always reported here, INCLUDING the `0`
      // case: on this provider a linked line is the normal, correct outcome,
      // so omitting the field would make "every line reached the warehouse"
      // indistinguishable from "this provider does not report linkage" (the
      // `null` a non-catalogue provider leaves behind).
      return {
        record,
        unlinkedCatalogueLines,
        warehouseRelease: this.readWarehouseRelease(response.warehouseReleaseNumber, zkId, cmd.orderId),
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * What the bridge did about releasing this sale's goods from the warehouse.
   *
   * The bridge has always answered - `warehouseReleaseNumber`, the WZ it
   * created or detected beside the invoice - and OpenLinker discarded it. A
   * document billed the client, and whether the stock actually left was
   * knowable only by opening Subiekt.
   *
   * ## The bridge's `null` is two different facts, and only this side can tell
   *
   * A `null` means "no linked ZK was found". That is correct and quiet for a
   * manually issued, order-less invoice - there is nothing to release. It is
   * the opposite for a sale: `resolveZkId` returns `null` on two paths, and the
   * bridge's own fallback then looks the order up by a column stamped with the
   * marketplace order NUMBER rather than OpenLinker's internal id, which this
   * adapter's own docblock records as never matching a natural order. So on a
   * real sale a `null` means the release did not happen.
   *
   * The bridge cannot distinguish them, because it does not know whether one
   * was due. This adapter does: it knows whether it passed a `zkId`. So the
   * ANSWER is resolved here and reported, rather than a raw wire value being
   * passed through for a later reader to misread.
   *
   * `undefined` on the wire is an older bridge build that does not report the
   * field at all, and reports `undefined` onward - "not reported", never a
   * manufactured failure.
   */
  private readWarehouseRelease(
    reported: string | null | undefined,
    zkId: number | null,
    orderId: string,
  ): WarehouseRelease | undefined {
    if (reported === undefined) return undefined;
    if (reported !== null && reported.trim().length > 0) {
      return { outcome: 'released', documentNumber: reported };
    }
    if (zkId === null) {
      // No order document was handed over, so nothing was due.
      return { outcome: 'not-applicable', documentNumber: null };
    }
    this.logger.error(
      `subiekt_warehouse_release_missing orderId=${orderId} zkId=${zkId} ` +
        `connection=${this.connectionId} — the invoice issued and Subiekt reported no warehouse ` +
        `release, so the client is billed and the stock has not moved.`,
    );
    return { outcome: 'not-released', documentNumber: null };
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
  async issueCorrection(cmd: IssueCorrectionCommand): Promise<IssueInvoiceResult> {
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
      return {
        record: new InvoiceRecord(
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
        ),
        // The Subiekt bridge builds and submits the korekta document itself —
        // no machine-readable document for OL to capture, same as issueInvoice.
        warehouseRelease: this.readCorrectionWarehouseRelease(response, cmd.orderId, origId),
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * The correction-side counterpart of `readWarehouseRelease` — same neutral
   * `WarehouseRelease` shape, a DIFFERENT signal underneath. A korekta carries
   * no confirmed-live way to reverse a warehouse movement, so Subiekt reports a
   * BOOLEAN (`stockAutoReleased`, `dok_JestRuchMag`), never a numbered WZ — a
   * `documentNumber` is therefore always `null` here, whatever the outcome.
   *
   * `undefined` on the wire is an older bridge build that omits the field —
   * reported onward as "not reported", the same rule `readWarehouseRelease`
   * applies. `quantityDeltas` is what tells "nothing was due" (a price-only
   * correction, `not-applicable`) apart from "a release was due and Subiekt did
   * not auto-apply it" (`not-released`, the alarm — the client's credit note
   * is issued and the stock never moved, so the caller must adjust it via the
   * inventory master's own `adjustInventory` for the reported deltas).
   */
  private readCorrectionWarehouseRelease(
    response: { stockAutoReleased?: boolean; quantityDeltas?: { lp: number; delta: number }[] | null },
    orderId: string,
    origId: number,
  ): WarehouseRelease | undefined {
    if (response.stockAutoReleased === undefined) return undefined;
    if (response.stockAutoReleased) {
      return { outcome: 'released', documentNumber: null };
    }
    if (response.quantityDeltas === undefined || response.quantityDeltas === null || response.quantityDeltas.length === 0) {
      // No quantity moved (e.g. a price-only correction) — nothing was due.
      return { outcome: 'not-applicable', documentNumber: null };
    }
    this.logger.error(
      `subiekt_correction_warehouse_release_missing orderId=${orderId} origId=${origId} ` +
        `connection=${this.connectionId} — the correction changed quantity on ` +
        `${response.quantityDeltas.length} line(s) and Subiekt did not auto-release the ` +
        `warehouse movement; the stock has not moved and must be adjusted directly.`,
    );
    return { outcome: 'not-released', documentNumber: null };
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
        // #3352: the bridge status read now carries the KSeF number too —
        // preferring the fresh read over the previously-captured value so a
        // reconcile can pick up a number that appeared since the last read,
        // falling back to what's already on the record if this read carries
        // none (a status flip can legitimately answer with no number yet).
        clearanceReference: status.clearanceReference ?? record.clearanceReference,
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Resolve each line's Subiekt catalogue symbol (`tw__Towar.tw_Symbol`) from
   * its OL-internal product id, through the SAME `identifier_mappings` lookup
   * `SubiektOrderProcessorAdapter.resolveLines` uses when it builds the ZK — so
   * the invoice names the same catalogue item the order did, resolved the same
   * way, rather than by a second and possibly-disagreeing rule.
   *
   * Returns a map keyed by product id. A product with no mapping on THIS
   * connection is simply absent from the map and its line degrades to a
   * free-text service line: an unmapped product must not fail an already-paid
   * order's fiscal document, which is the one thing that would be worse than a
   * line the warehouse cannot see. The degradation is warn-logged, because it
   * is also exactly the condition under which stock silently will not move.
   *
   * Never throws: like `resolveZkId`, this is an enrichment of the request, not
   * a precondition for issuing it.
   */
  /**
   * The Subiekt `tw_Symbol` behind one OL variant, or `null`.
   *
   * The same lookup `SubiektOrderProcessorAdapter.resolveTowarSymbol` makes,
   * and for the same reason - a model member names its towar only on the
   * variant. Never throws: the caller counts an unresolved line and the
   * document still issues, as a free-text position, which is what the
   * `unlinkedCatalogueLines` figure reports to the operator.
   */
  private async resolveVariantTowarSymbol(variantId: string): Promise<string | null> {
    const variantMappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ProductVariant,
      variantId,
    );
    const mapping = variantMappings.find((e) => e.connectionId === this.connectionId);
    if (!mapping || mapping.externalId === '') {
      return null;
    }
    const symbol = towarSymbolFromVariantExternalId(mapping.externalId);
    return symbol === '' ? null : symbol;
  }

  private async resolveTowarSymbols(
    lines: readonly { productId?: string; variantId?: string }[],
  ): Promise<{ symbolByProductId: Map<string, string>; unmappedCatalogueKeys: Set<string> }> {
    const resolved = new Map<string, string>();
    // Keyed by the LINE's catalogue key - `variantId` when it has one - not by
    // the product. A Subiekt MODEL is ONE OL product standing for several
    // towary, so two members of the same model on one document share a
    // `productId` and need different symbols; a product-keyed map would give
    // them both whichever resolved last.
    const keys = [
      ...new Map(
        lines
          .filter((line) => line.productId !== undefined && line.productId !== '')
          .map((line) => [line.variantId ?? line.productId!, line] as const),
      ).values(),
    ];
    if (keys.length === 0) {
      return { symbolByProductId: resolved, unmappedCatalogueKeys: new Set() };
    }

    const unmapped: string[] = [];
    for (const line of keys) {
      const productId = line.productId!;
      const key = line.variantId ?? productId;
      try {
        const externalIds = await this.identifierMapping.getExternalIds(
          CORE_ENTITY_TYPE.Product,
          productId,
        );
        const mapping = externalIds.find((e) => e.connectionId === this.connectionId);
        // A MODEL's product external id is `model:{mdt_Id}` - a grouping, not a
        // towar. Sending it reaches `d.Pozycje.Dodaj("model:5")` bridge-side,
        // inside a try that carries no catch, so the whole issuance fails with
        // a raw COM message. It does NOT degrade to a free-text line: the
        // mapping exists and is non-empty, so nothing here would have called it
        // unmapped either. The towar lives on the VARIANT.
        const isModel =
          mapping !== undefined && modelIdFromProductKey(mapping.externalId) !== null;
        if (mapping && mapping.externalId !== '' && !isModel) {
          resolved.set(key, mapping.externalId);
          continue;
        }

        const variantSymbol = line.variantId
          ? await this.resolveVariantTowarSymbol(line.variantId)
          : null;
        if (variantSymbol) {
          resolved.set(key, variantSymbol);
        } else {
          // #3365 review: the same key `resolved` uses, not the bare product id.
          // A Subiekt MODEL is ONE OL product standing for several towary, so two
          // of its members on one document share a `productId` - recording the
          // product here made ONE unresolved variant mark every sibling line
          // unlinked, including the ones that resolved perfectly well.
          unmapped.push(key);
        }
      } catch (error: unknown) {
        unmapped.push(key);
        this.logger.warn(
          'Subiekt resolveTowarSymbols: identifier-mapping lookup failed; the line falls back to a free-text service line and will not move stock',
          {
            connectionId: this.connectionId,
            productId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    if (unmapped.length > 0) {
      this.logger.warn(
        'Subiekt resolveTowarSymbols: product(s) have no Subiekt catalogue mapping on this connection; their document lines will be free-text and will NOT release warehouse stock',
        { connectionId: this.connectionId, catalogueKeys: unmapped },
      );
    }
    return { symbolByProductId: resolved, unmappedCatalogueKeys: new Set(unmapped) };
  }

  /**
   * Resolve the order's Subiekt ZK numeric `dok_Id` for the #3431
   * warehouse-release step, via the SAME `identifier_mappings` row
   * `OrderSyncService.persistDestinationMapping` writes when the order was
   * created (`createMapping(Order, orderRef.orderId, destinationConnectionId,
   * internalOrderId)` — and `SubiektOrderProcessorAdapter.createOrder` returns
   * `orderId: String(response.id)`, the ZK's own `dok_Id`). This is a direct
   * cross-reference, not a string-matching search.
   *
   * It used to additionally sidestep an order-number-vs-order-id mismatch:
   * `EnsureWarehouseRelease`'s fallback `FindZkIdByOrderRef(orderId)` searches
   * `dok_NrPelnyOryg` for the OL-internal order id, while `createOrder` stamped
   * that column with the marketplace order NUMBER, so the fallback could never
   * match a natural order. **That mismatch is gone** - `createOrder` now sends
   * `orderRef: order.internalOrderId` (the source number moved to `uwagi`,
   * because a per-shop-sequential number is not a safe dedupe key across two
   * shops), so the bridge's fallback finally means what it says.
   *
   * This read stays the primary anyway: a direct id cross-reference beats a
   * string search on a document column whichever value that column holds.
   *
   * Returns `null` (never throws) when the mapping row doesn't exist yet —
   * an order created before this fix shipped, or one whose ZK was mapped
   * under a different connection — the bridge falls back to its
   * pre-existing lookup in that case. A lookup failure is swallowed the
   * same way, as defense-in-depth: the ZK id is an OPTIMIZATION for a
   * downstream step, never a precondition for issuing the invoice itself.
   */
  private async resolveZkId(orderId: string): Promise<number | null> {
    try {
      const mappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Order,
        orderId,
      );
      const mapping = mappings.find((m) => m.connectionId === this.connectionId);
      if (!mapping) {
        return null;
      }
      const zkId = Number(mapping.externalId);
      return Number.isInteger(zkId) && zkId > 0 ? zkId : null;
    } catch (error: unknown) {
      this.logger.warn(
        'Subiekt resolveZkId: identifier-mapping lookup failed; falling back to the bridge order-ref search',
        {
          connectionId: this.connectionId,
          orderId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }

  /**
   * Last-resort crash-recovery lookup (#3389, ADR-035): find a document on
   * Subiekt's own side after a process died mid-submit and OL no longer knows
   * whether the request landed. Subiekt is a SELF-NUMBERING provider (the GT
   * document number is assigned only in the response, unlike a
   * `DocumentNumberConsumer` such as KSeF, where core allocates the number
   * BEFORE the request) — so `criteria.documentNumber` is structurally unknown
   * for exactly the crash this method exists to recover from, and
   * `criteria.idempotencyKey` (#3389) is the only reliable locate key: it is the
   * value stamped onto `dok_NrPelnyOryg` at write time, which the bridge already
   * uses for its own create-time dedup (#3369). A missing `idempotencyKey`
   * (a keyless issuance) means this adapter has nothing to search by — returns
   * `null` rather than guessing from `documentNumber`, which for Subiekt was
   * never populated pre-crash in the first place.
   */
  async locateByQuery(criteria: RegulatoryLocateCriteria): Promise<RegulatoryLocateResult | null> {
    if (criteria.idempotencyKey === undefined) {
      this.logger.debug(
        'Subiekt locateByQuery called with no idempotencyKey (the only key this self-numbering provider can search by); returning null',
        { connectionId: this.connectionId },
      );
      return null;
    }

    try {
      const located = await this.bridge.locateByOriginalKey(criteria.idempotencyKey);
      if (!located.found) {
        return null;
      }
      return {
        providerInvoiceId: String(located.providerInvoiceId),
        regulatoryStatus: toNeutralRegulatoryStatus(located.regulatoryStatus),
        clearanceReference: located.clearanceReference,
      };
    } catch (error: unknown) {
      throw this.translateBridgeError(error);
    }
  }

  /**
   * Read Subiekt's own settled/paid flag (#3390, `dok_Rozliczony`) for an
   * already-issued document — the READ half of the payment-status seam
   * (`PaymentStatusReader`). A single boolean, no partial-payment concept, so
   * the neutral mapping is exhaustively `paid` / `unpaid` — never
   * `'partially-paid'` or `'unknown'` for a record that resolves at all. A
   * record with no `providerInvoiceId` cannot be read back — mirrors
   * `getClearanceStatus`'s same no-transport-call rule for the identical reason.
   */
  async getPaymentStatus(record: InvoiceRecord): Promise<PaymentStatusResult> {
    if (record.providerInvoiceId === null || record.providerInvoiceId.length === 0) {
      this.logger.debug(
        'Subiekt getPaymentStatus called for a record without a providerInvoiceId; returning unknown',
        { connectionId: this.connectionId, recordId: record.id },
      );
      return { paymentStatus: 'unknown' };
    }
    try {
      const status = await this.bridge.getInvoiceStatus({
        providerInvoiceId: record.providerInvoiceId,
      });
      return { paymentStatus: status.paid ? 'paid' : 'unpaid' };
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
   *   - the neutral `MissingTaxRateException` (raised by the line mapper while
   *     the request body is built) passes through, so the refusal keeps its
   *     product-naming message and its terminal treatment (#2260 review).
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
    // #2260 review: the line mapper's tax-rate refusal is raised while the
    // request body is being built, so it lands here. Wrapped as an
    // `indeterminate` transport error it lost both the message that names the
    // product and its terminal classification - the exact opposite of what the
    // mapper's own docstring promises. Pass it through unchanged.
    if (error instanceof MissingTaxRateException) {
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
