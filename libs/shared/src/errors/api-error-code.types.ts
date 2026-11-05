/**
 * API error codes
 *
 * The stable machine codes an API error response carries in `code` (#3860).
 * The frontend picks its copy by code (ADR-081: the backend never sends
 * translated text), so a code is a contract: it is never renamed, and its
 * meaning never changes.
 *
 * `ApiErrorCodeValues` lists the codes the API mints by name. Later issues of
 * the error-code track add theirs here (#3861 validation, #3863 the domain
 * filters and the endpoints that already send a code). Every other error falls
 * back to its status family, `HTTP_<status>`.
 *
 * @module libs/shared/src/errors
 */

export const ApiErrorCodeValues = [
  /** An error the API did not anticipate; the body never carries its message. */
  'INTERNAL_ERROR',
  /** The request body failed validation; `fields` lists what failed and why (#3861). */
  'VALIDATION_FAILED',
  /**
   * An external system refused the request. `params.provider` names it; its own
   * words, never translated, travel in the envelope's `providerMessage` (#3864).
   */
  'PROVIDER_REJECTED',

  // ── Connections (#3864) ──
  /** No connection has this id. params: `connectionId`. */
  'CONNECTION_NOT_FOUND',
  /**
   * A `config` value is refused. params: `field` (dotted path), `rule` (what the
   * value must be: `object`, `boolean`, `string`, `email`, `one-of`, `min`,
   * `range`, `greater-than-zero`, `below-100`, `required-with`, `set-together`,
   * `known-template`, `shop-only-template`), plus the rule's `min`, `max`,
   * `allowed`, `with` or `template`.
   */
  'CONNECTION_CONFIG_INVALID',
  /** Another active connection already uses this value. params: `field`, `value`, `otherConnectionId`, `otherConnectionName`. */
  'CONNECTION_CONFIG_NOT_UNIQUE',
  /** Stock master and stock write-back cannot both be on. params: `capabilities`. */
  'CONNECTION_CAPABILITIES_CONFLICT',
  /** The adapter does not offer these capabilities. params: `adapterKey`, `capabilities`. */
  'CONNECTION_CAPABILITIES_UNSUPPORTED',
  /** Fulfilment routing needs an active inventory location first. */
  'ROUTING_REQUIRES_ACTIVE_LOCATION',
  /** `config.stockLocationOverride` is refused. params: `reason` (`empty`, `unknown-location`, `inactive-location`), `locationId`. */
  'STOCK_LOCATION_OVERRIDE_INVALID',
  /** The adapter cannot set up webhooks. params: `adapterKey`. */
  'WEBHOOK_PROVISIONING_UNSUPPORTED',
  /** The adapter cannot test a connection. params: `adapterKey`. */
  'CONNECTION_TEST_UNSUPPORTED',
  /** Send exactly one of `credentials` or `credentialsRef`. */
  'CREDENTIALS_INPUT_AMBIGUOUS',
  /** `credentialsRef` must start with `db:`. */
  'CREDENTIALS_REF_INVALID',
  /** The stored credentials cannot be replaced in place. params: `connectionId`. */
  'CREDENTIALS_ROTATION_UNSUPPORTED',
  /** The adapter takes no credentials. params: `connectionId`. */
  'CREDENTIALS_NOT_ACCEPTED',
  /** `adapterKey` cannot change after creation. params: `current` (empty when derived). */
  'CONNECTION_ADAPTER_KEY_IMMUTABLE',
  /** Archiving goes through its own endpoint, not a status change. */
  'CONNECTION_ARCHIVE_NOT_BY_STATUS',
  /** The connection is archived; restore it first. params: `connectionId`. */
  'CONNECTION_ARCHIVED',
  /** Only a disabled connection can be archived. params: `status`. */
  'CONNECTION_NOT_DISABLED',
  /** The adapter forbids archiving this connection. params: `adapterKey`. */
  'CONNECTION_NOT_ARCHIVABLE',
  /** Only an archived connection can be restored. params: `status`. */
  'CONNECTION_NOT_ARCHIVED',

  // ── Invoicing (#3864) ──
  /** No sales document has this id. params: `invoiceId`. */
  'INVOICE_NOT_FOUND',
  /** No order has this id. params: `orderId`. */
  'ORDER_NOT_FOUND',
  /** The order has no sales document yet. params: `orderId`. */
  'ORDER_HAS_NO_INVOICE',
  /** The order already has an issued document. params: `orderId`. */
  'INVOICE_ALREADY_ISSUED',
  /** A document for the order is being issued now. params: `orderId`. */
  'INVOICE_ISSUE_IN_PROGRESS',
  /** Another request is issuing for this order; retry shortly. */
  'INVOICE_ISSUE_CONTENDED',
  /** A document with this idempotency key exists already. */
  'INVOICE_RECORD_DUPLICATE',
  /** The order already has a document on another connection. */
  'ORDER_ALREADY_INVOICED',
  /** The order already has a fiscal receipt. */
  'ORDER_ALREADY_HAS_FISCAL_RECEIPT',
  /** The order is cancelled; issuing needs an acknowledgement. */
  'ORDER_CANCELLED',
  /** The order is fully refunded; issuing needs an acknowledgement. */
  'ORDER_FULLY_REFUNDED',
  /** A correction of this document is already in progress. */
  'CORRECTION_IN_PROGRESS',
  /** A previous correction attempt needs to be checked with the provider first. */
  'CORRECTION_NEEDS_RECONCILIATION',
  /** Some lines have no tax rate. params: `missingCount`, `lineCount`. */
  'MISSING_TAX_RATE',
  /** The connection has no numbering series for this document. */
  'MISSING_NUMBERING_SERIES',
  /** The document data is refused. params: `reason` (`buyer-profile`, `invoice-line`, `price-treatment`, `unknown-order-lines`), `lines`. */
  'INVOICE_DATA_INVALID',
  /** The buyer's details are not stored for this order. params: `orderId`. */
  'ORDER_BUYER_DETAILS_UNAVAILABLE',
  /** The provider refused the document. params: `failureCode`. */
  'INVOICE_ISSUE_REJECTED',
  /** Issuing failed for a reason the log records. params: `correlationId`. */
  'INVOICE_ISSUE_FAILED',
  /** The document was not fully issued. params: `invoiceId`, `missing` (`provider-invoice-id`, `document-number`). */
  'INVOICE_NOT_FULLY_ISSUED',
  /** Only a document the authority rejected can be sent again. params: `invoiceId`, `regulatoryStatus`. */
  'INVOICE_NOT_REJECTED',
  /**
   * The document file cannot be served. params: `invoiceId`, `reason`
   * (`no-snapshot`, `no-source`, `not-ready`, `no-downloads`, `kind-unsupported`,
   * `not-cleared`, `no-confirmation`, `too-large`), and where known `kind`,
   * `status`, `regulatoryStatus`, `limitBytes`.
   */
  'INVOICE_DOCUMENT_UNAVAILABLE',
  /** Unknown document kind. params: `kind`, `supported`. */
  'DOCUMENT_KIND_UNKNOWN',
  /** The provider does not offer this. params: `capability`, `connectionId`. */
  'PROVIDER_CAPABILITY_UNSUPPORTED',
  /** The invoicing provider could not be reached. */
  'INVOICING_PROVIDER_UNAVAILABLE',
  /** The invoicing provider failed the request. */
  'INVOICING_PROVIDER_REQUEST_FAILED',
  /** The marketplace upload could not be queued; try again. params: `invoiceId`. */
  'MARKETPLACE_UPLOAD_NOT_QUEUED',
  /** No numbering series has this id. params: `seriesId` where known. */
  'NUMBERING_SERIES_NOT_FOUND',
  /** The numbering pattern is refused; `errors` lists why. */
  'NUMBERING_PATTERN_INVALID',
  /** Explaining a numbering gap needs a reason. */
  'NUMBERING_GAP_REASON_REQUIRED',
  /** The pattern renders a number longer than the provider allows. params: `actualLength`, `maxLength`. */
  'DOCUMENT_NUMBER_TOO_LONG',
  /** This document number was already issued on the connection. */
  'DOCUMENT_NUMBER_DUPLICATE',
] as const;

export type KnownApiErrorCode = (typeof ApiErrorCodeValues)[number];

/** The fallback for an error with no code of its own: `HTTP_404`, `HTTP_409` ... */
export type HttpStatusErrorCode = `HTTP_${number}`;

export type ApiErrorCode = KnownApiErrorCode | HttpStatusErrorCode;

export function httpStatusErrorCode(status: number): HttpStatusErrorCode {
  return `HTTP_${status}`;
}
