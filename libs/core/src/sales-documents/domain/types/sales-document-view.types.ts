/**
 * Sales-Document View Types (#2515, ADR-065)
 *
 * The ONE neutral per-order read every sales-document surface uses: the
 * `/orders` row, the order-detail panel, and the settings page's per-market
 * evidence. Three surfaces answering the same question three ways is what this
 * type exists to prevent.
 *
 * Two rules from ADR-065 are structural here, not documentation:
 *
 * 1. **No third vocabulary.** The states below ARE `InvoiceStatus`,
 *    `RegulatoryStatus` and `FiscalRegistrationStatus`, borrowed by name from
 *    the contexts that own them. A flattened single enum was rejected: it
 *    cannot express *issued, then rejected by the authority* - the exact state
 *    `RegulatoryResubmitter` exists for - and `cleared` means nothing on a
 *    receipt. A value that type-checks and means nothing is worse than two
 *    axes.
 * 2. **A fiscal receipt has no authority axis.** `SalesDocumentReceiptView`
 *    carries no regulatory field at all, so no surface can render an authority
 *    answer that does not exist (ADR-042). The two members are a discriminated
 *    union rather than one optional-field shape precisely so the missing axis
 *    is UNREPRESENTABLE rather than merely unset.
 *
 * A third rule lives on {@link SalesDocumentView} itself: the persisted block
 * and unresolved reasons travel VERBATIM. A surface renders the stored value or
 * renders nothing - it never re-derives one from the order (ADR-041 decision
 * 11; a draft of this redesign printed `no rule for PL` from the order's own
 * country while the persisted reason said something else entirely, which is a
 * false statement about the operator's configuration).
 *
 * The two cross-context imports are TYPE-ONLY and reach the dedicated
 * cycle-breaker sub-barrels, never the main context barrels - see
 * `libs/core/src/__tests__/barrel-purity.spec.ts`, which authorizes exactly
 * these specifiers and still forbids every value import.
 *
 * Timestamps are ISO-8601 strings, never `Date`, matching the read-side
 * convention `sales-document-country-summary.types.ts` already follows: this is
 * a wire-shaped projection meant to cross the service boundary unchanged.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/065-sales-document-read-surface.md
 */
import type {
  FiscalRegistrationFailureMode,
  FiscalRegistrationStatus,
} from '@openlinker/core/fiscalization/types';
import type {
  DocumentType,
  InvoiceFailureCode,
  InvoiceFailureMode,
  InvoiceStatus,
  RegulatoryStatus,
} from '@openlinker/core/invoicing/types';

import type { SalesDocumentKind } from './sales-document-kind.types';
import type {
  SalesDocumentGateBlockReason,
  SalesDocumentUnresolvedReason,
} from './sales-document-reason.types';

/**
 * The identity fields a surface renders for a document, whichever kind it is.
 *
 * Shared between the two union members because they are the same facts about
 * two different acts, and a surface renders them identically.
 */
export interface SalesDocumentIdentity {
  /** The underlying record's own id, for the per-document routes. */
  readonly recordId: string;
  /** The connection that issued or registered it. */
  readonly connectionId: string;
  /**
   * Provider identity as the record reports it. `null` when the record exists
   * but no provider has been resolved onto it yet (a fiscal row carries `''`
   * until the adapter answers, normalized to `null` here) - never a default.
   */
  readonly providerType: string | null;
  /**
   * The number the document itself bears, whoever allocated it - OL's own
   * `documentNumber`, the provider's number, or a fiscal `documentReference`.
   * `null` means no number has been assigned yet, NOT that the document has
   * none: nothing here distinguishes a regime with no numbering from a
   * document not yet issued, and no surface may claim otherwise.
   */
  readonly documentNumber: string | null;
  /** When OL first recorded the attempt. Always present. */
  readonly createdAt: string;
  /**
   * When the act completed at the provider - an invoice's `issuedAt`, a
   * registration's `registeredAt`. `null` while the document is still pending,
   * in flight, or failed.
   */
  readonly completedAt: string | null;
  /**
   * While an attempt holds the in-flight claim, when that claim expires.
   * `null` means no claim is held, which is NOT the same as "not in flight":
   * a lease in the PAST is a crashed attempt, not a live one, so a surface
   * showing "another attempt is running" must compare this against now rather
   * than test it for presence.
   */
  readonly inFlightUntil: string | null;
}

/**
 * An invoice, on BOTH its axes.
 *
 * `status` is issuance (did the provider create a document), `regulatoryStatus`
 * is clearance (what the authority said about it). They move independently, and
 * the pair `status: 'issued'` + `regulatoryStatus: 'rejected'` is the state
 * that a single flattened enum could not express.
 */
export interface SalesDocumentInvoiceView {
  readonly kind: 'invoice';
  /**
   * Neutral document type the provider issued. Open-world for the same reason
   * `DocumentTypeValues` is (ADR-026): a regime may carry a document neither
   * core nor this projection has seen, and the union shape keeps the
   * well-known values in editor autocomplete rather than only in prose.
   */
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- open-world by ADR-026; `string` is not redundant in intent, only in structural assignability (same shape as `SalesDocumentKind`).
  readonly documentType: DocumentType | string;
  /** Issuance axis. Terminal at `issued` or `failed`. */
  readonly status: InvoiceStatus;
  /**
   * Whether a `failed` issuance is known to have created nothing (`rejected`)
   * or may have created a document OL cannot see (`in-doubt`). `null` unless
   * `status === 'failed'`; an ABSENT mode on a failed row is treated exactly
   * as `in-doubt` is by the write-path guards, so a surface must never read
   * `null` here as "safe to retry".
   */
  readonly failureMode: InvoiceFailureMode | null;
  /** Machine-readable failure cause; `null` unless `status === 'failed'`. */
  readonly failureCode: InvoiceFailureCode | null;
  /** Short PII-free failure summary; `null` unless `status === 'failed'`. */
  readonly failureReason: string | null;
  /**
   * Clearance axis. `'not-applicable'` is an ANSWER (this regime clears
   * nothing), never a stand-in for "not asked yet" - that is
   * `'pending-submission'`.
   */
  readonly regulatoryStatus: RegulatoryStatus;
  /**
   * The authority-assigned reference once one exists. `null` until the
   * authority answers, and on every regime that assigns none.
   */
  readonly clearanceReference: string | null;
  readonly identity: SalesDocumentIdentity;
}

/**
 * A fiscal receipt, on its ONE axis.
 *
 * There is deliberately no regulatory field: the registering mechanism IS the
 * authority, so there is no later answer to wait for and none to render
 * (ADR-042). `registered` is terminal.
 */
export interface SalesDocumentReceiptView {
  readonly kind: 'fiscal-receipt';
  /** Registration axis. Terminal at `registered` or `failed`. */
  readonly status: FiscalRegistrationStatus;
  /**
   * Same semantics as the invoice sibling: `null` unless `status === 'failed'`,
   * and an absent mode on a failed row is as unsafe to re-attempt as
   * `in-doubt`.
   */
  readonly failureMode: FiscalRegistrationFailureMode | null;
  /** Short PII-free failure summary; `null` unless `status === 'failed'`. */
  readonly failureReason: string | null;
  /**
   * How many customer-facing artefacts the registration produced. `0` on a
   * `registered` row is a SUCCESS, not a failure - a pure reporting regime
   * returns identifiers and no artefact at all.
   */
  readonly artefactCount: number;
  readonly identity: SalesDocumentIdentity;
}

/** The document this order actually has, on the axis belonging to its kind. */
export type SalesDocumentRecordView = SalesDocumentInvoiceView | SalesDocumentReceiptView;

/**
 * A record held for the same order on ANOTHER connection.
 *
 * Reported rather than hidden: one order gets one originating document
 * (ADR-041 decision 3), so a second record is either a pre-existing duplicate
 * an operator must see, or a terminal `rejected` attempt that legitimately
 * left the sale free. The two are told apart by {@link blocksFurtherIssuance},
 * which mirrors the write-path guard rather than restating it - a surface must
 * never recompute that predicate from `status`.
 */
export interface SalesDocumentOtherRecord {
  readonly connectionId: string;
  readonly kind: SalesDocumentKind;
  /** True when this record is why another connection may not issue. */
  readonly blocksFurtherIssuance: boolean;
}

/**
 * Everything the three surfaces need about one order's sales document.
 */
export interface SalesDocumentView {
  readonly orderId: string;
  /**
   * The kind this order's document is on: the existing record's kind when
   * there is one, otherwise the kind routing resolves for the order.
   *
   * `null` means routing has NOT decided - the surface says so and points at
   * the settings. It never falls back to asking which document to issue, and
   * it never guesses a kind from the order's country.
   */
  readonly documentKind: SalesDocumentKind | null;
  /**
   * The document itself, or `null` when none exists yet. `null` with a
   * non-null {@link documentKind} is the ordinary "routing decided, nothing
   * issued yet" state; `null` with a null kind is the unconfigured one.
   */
  readonly document: SalesDocumentRecordView | null;
  /**
   * The PERSISTED gate reason, verbatim from `order_records`. `null` means the
   * gate reported no block on its last run, not that it never ran.
   */
  readonly blockReason: SalesDocumentGateBlockReason | null;
  /**
   * The PERSISTED routing reason, verbatim. Non-null only alongside
   * `blockReason === 'unresolved-routing'`, which is the bridge value carrying
   * it (ADR-041 §107).
   */
  readonly unresolvedReason: SalesDocumentUnresolvedReason | null;
  /**
   * Free-text detail the gate stored with the reason; `null` when it stored
   * none. Never parsed by a surface - it is displayed or dropped.
   */
  readonly blockDetail: string | null;
  /**
   * Records for this order on other connections. Empty for the overwhelming
   * majority of orders; a non-empty list is surfaced, never hidden behind the
   * single-record panel.
   */
  readonly otherRecords: readonly SalesDocumentOtherRecord[];
}
