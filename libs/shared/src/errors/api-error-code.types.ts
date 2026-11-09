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

  // ── Orders (#3865) ──
  /** Too many test emails from this user; wait before sending another. */
  'BUYER_EMAIL_TEST_RATE_LIMITED',
  /** The test email address is not a single valid address. */
  'BUYER_EMAIL_TEST_ADDRESS_INVALID',
  /** This connection may not send that buyer email template. params: `templateKey`. */
  'BUYER_EMAIL_TEMPLATE_NOT_ALLOWED',
  /** The test email could not be sent; try again later. */
  'BUYER_EMAIL_TEST_SEND_FAILED',
  /** `?phase=` and `?cancelled=` can never both hold. params: `phase`, `cancelled`. */
  'ORDER_FILTERS_CONTRADICTORY',
  /** The order has no sync status for this destination. params: `orderId`, `connectionId`. */
  'ORDER_DESTINATION_NOT_FOUND',
  /** Only a failed destination sync can be retried. params: `orderId`, `connectionId`, `status`. */
  'ORDER_DESTINATION_NOT_RETRYABLE',
  /** The order has no source external id for the connection (500). params: `orderId`, `connectionId`. */
  'ORDER_SOURCE_ID_MISSING',
  /** The routing retry could not be queued; try again. params: `orderId`. */
  'ROUTING_RETRY_NOT_QUEUED',
  /** No such hold on the order. params: `orderId`, `holdId`. */
  'ORDER_HOLD_NOT_FOUND',
  /** Releasing a hold a service placed needs a note. params: `holdId`, `placedByService`. */
  'HOLD_RELEASE_NOTE_REQUIRED',
  /** This actor may not release the hold. params: `holdId`. */
  'HOLD_RELEASE_NOT_PERMITTED',
  /** No such change on the order. params: `orderId`, `changeId`. */
  'ORDER_CHANGE_NOT_FOUND',
  /** Cancelling with reason "other" needs a note. */
  'ORDER_CANCEL_NOTE_REQUIRED',
  /** The cancellation reason is not one of the closed reasons. params: `reason`. */
  'ORDER_CANCEL_REASON_INVALID',
  /** No such line on the order. params: `orderId`, `orderLineId`. */
  'ORDER_LINE_NOT_FOUND',
  /**
   * The edit payload cannot describe an edit. params: `reason` (`line-repeated`,
   * `quantity-invalid`, `no-lines`, `delivery-method-required`,
   * `discount-amount-or-percent`, `discount-amount-format`,
   * `discount-amount-precision`, `discount-percent-range`, `currency-missing`),
   * plus `orderLineId` or `currency`, `decimalPlaces` where they apply.
   */
  'ORDER_EDIT_INVALID',
  /** No column preset has this id (or it is not the caller's). params: `presetId`. */
  'ORDER_COLUMN_PRESET_NOT_FOUND',
  /** No export run has this id. params: `runId`. */
  'ORDER_EXPORT_NOT_FOUND',
  /** The export file is not ready yet. params: `runId`. */
  'ORDER_EXPORT_NOT_READY',
  /** The export file has expired; request a new one. params: `runId`. */
  'ORDER_EXPORT_EXPIRED',
  /** Only the requester or an admin may access the export. params: `runId`. */
  'ORDER_EXPORT_FORBIDDEN',
  /** No order note has this id. params: `noteId`. */
  'ORDER_NOTE_NOT_FOUND',
  /** Only the note's author (or an admin, for delete) may do this. params: `noteId`. */
  'ORDER_NOTE_NOT_AUTHOR',
  /** No order tag has this id. params: `tagId`. */
  'ORDER_TAG_NOT_FOUND',
  /** The workspace already has the most tags it may hold. params: `limit`. */
  'ORDER_TAG_LIMIT_REACHED',
  /** A refund with this idempotency key already exists for the order. params: `orderId`. */
  'REFUND_RECORD_DUPLICATE',
  /** The refund's currency differs from the order's earlier refunds. params: `orderId`. */
  'REFUND_CURRENCY_MISMATCH',
  /** The refund amount has more decimal places than its currency allows. params: `amount`, `currency`, `allowedFractionDigits`. */
  'REFUND_AMOUNT_PRECISION',
  /** A list cursor cannot be read; restart the listing without it. */
  'CURSOR_MALFORMED',

  // ── Fulfillment (#3865) ──
  /** The action is not one an operator may invoke. params: `action`, `supported` (comma-separated). */
  'FULFILLMENT_ACTION_UNSUPPORTED',
  /** The action needs a field the request did not send. params: `action`, `field`. */
  'FULFILLMENT_ACTION_FIELD_MISSING',
  /** An assignment update named nothing to change. params: `workId`. */
  'FULFILLMENT_ASSIGNMENT_UPDATE_EMPTY',
  /** No fulfilment work has this id. params: `workId`. */
  'FULFILLMENT_WORK_NOT_FOUND',
  /** No fulfilment hold has this id. params: `holdId`. */
  'FULFILLMENT_HOLD_NOT_FOUND',
  /** The work already carries the most active holds it may. params: `workId`, `activeHolds`, `limit`. */
  'FULFILLMENT_HOLD_LIMIT_REACHED',
  /** The hold was already released. params: `holdId`, `releasedAt` (ISO). */
  'FULFILLMENT_HOLD_ALREADY_RELEASED',
  /** The work cannot be made exclusive: it has no assigned packer. params: `workId`. */
  'FULFILLMENT_EXCLUSIVE_NEEDS_PACKER',
  /** The order has no routing decision. params: `orderId`. */
  'ROUTING_DECISION_NOT_FOUND',

  // ── Pack bench (#3865) ──
  /** The parcel does not exist or is not one this bench may see (deliberately one code for both). */
  'BENCH_PARCEL_NOT_FOUND',
  /** The parcel's order has no issued invoice. params: `workId`. */
  'BENCH_INVOICE_NOT_ISSUED',
  /** The invoice has no printable version; send the box without it. params: `workId`. */
  'BENCH_INVOICE_NOT_PRINTABLE',
  /** The parcel's order has no receipt to open. params: `workId`. */
  'BENCH_RECEIPT_NOT_FOUND',
  /** The parcel has no label yet. params: `workId`. */
  'BENCH_LABEL_NOT_READY',
  /** The label could not be retrieved; check with dispatch. params: `workId`. */
  'BENCH_LABEL_UNAVAILABLE',
  /** Replacing the label was refused. params: `reason` (a `BenchReplaceLabelRefusalReason`). */
  'BENCH_LABEL_REPLACE_REFUSED',
  /** A label replacement must send exactly one parcel shape (template, box, or weight). */
  'BENCH_LABEL_PARCEL_AMBIGUOUS',
  /** The signed-in token names no packer (401). */
  'BENCH_PACKER_UNIDENTIFIED',

  // ── Inventory (#3865) ──
  /** No inventory location has this id. params: `locationId`. */
  'INVENTORY_LOCATION_NOT_FOUND',
  /** No product has this id. params: `productId`. */
  'PRODUCT_NOT_FOUND',

  // ── Shipping (#3865) ──
  /** The order has no active shipment. params: `orderId`. */
  'ORDER_HAS_NO_ACTIVE_SHIPMENT',
  /** No shipment has this id. params: `shipmentId` where known. */
  'SHIPMENT_NOT_FOUND',
  /** The shipment cannot be cancelled in its state. params: `shipmentId`. */
  'SHIPMENT_NOT_CANCELLABLE',
  /** Another dispatch for the order is in progress; nothing was bought, retry. params: `orderId`. */
  'SHIPMENT_DISPATCH_CONTENDED',
  /** The handover protocol batch is refused (empty, no labels, or mixed carriers). */
  'HANDOVER_PROTOCOL_BATCH_INVALID',
  /** The carrier connection cannot cancel shipments. params: `shipmentId`, `connectionId`. */
  'SHIPMENT_CANCELLATION_UNSUPPORTED',
  /** The fulfilment routing resolution cannot be dispatched. */
  'SHIPMENT_ROUTING_UNDISPATCHABLE',
  /** The order's payment status does not allow dispatch. params: `orderId`, `paymentStatus`. */
  'ORDER_NOT_DISPATCHABLE_PAYMENT_STATUS',
  /** The order is on hold. params: `orderId`, `holdId`, `holdReason`. */
  'ORDER_NOT_DISPATCHABLE_HELD',
  /** The carrier connection cannot return label documents. params: `shipmentId`, `connectionId`. */
  'SHIPMENT_LABEL_DOCUMENT_UNSUPPORTED',
  /** No label has been generated for the shipment yet. params: `shipmentId`. */
  'SHIPMENT_LABEL_NOT_GENERATED',
  /** The carrier connection cannot generate handover protocols. params: `connectionId`. */
  'HANDOVER_PROTOCOL_UNSUPPORTED',
  /** The carrier rejected OpenLinker's stored credentials. params: `provider`, `connectionId` where known. */
  'SHIPPING_PROVIDER_AUTH_FAILED',
  /**
   * The carrier rejected the request. params: `provider`, `providerCode` where
   * known. The carrier's words stay in `message` only for a writer (they can
   * echo an address); extras keep `providerCode` and `details`.
   */
  'SHIPPING_PROVIDER_REJECTED',
  /** A shipping command failed for an unclassified reason (500). */
  'SHIPPING_COMMAND_FAILED',
  /** The pickup point is not in the cache. params: `providerId`. */
  'PICKUP_POINT_NOT_CACHED',
  /** The connection has no pickup-point lookup. params: `connectionId`. */
  'PICKUP_POINT_LOOKUP_UNSUPPORTED',
  /** The pickup-point search failed at the provider; its words are logged only. params: `connectionId`. */
  'PICKUP_POINT_SEARCH_FAILED',

  // ── Customers (#3865) ──
  /** No customer has this id. params: `customerId`. */
  'CUSTOMER_NOT_FOUND',

  // ── Analytics (#3865) ──
  /** The range's `to` is not after its `from`. */
  'ANALYTICS_RANGE_INVALID',
  /** The range spans more days than the read allows. params: `days`, `maxDays`. */
  'ANALYTICS_RANGE_TOO_WIDE',
  /** No currency-mismatched orders in the range; nothing to recalculate. */
  'CURRENCY_RECALCULATION_NOTHING_TO_DO',
  /** A currency recalculation is already running. */
  'CURRENCY_RECALCULATION_IN_PROGRESS',
  /** No currency recalculation is running; nothing to cancel. */
  'CURRENCY_RECALCULATION_NOT_IN_PROGRESS',
  /** No remediation run has this id. params: `runId`. */
  'REMEDIATION_RUN_NOT_FOUND',

  // ── Currency (#3865) ──
  /** No stored exchange rate for this pair and date. params: `from`, `to`, `date`. */
  'EXCHANGE_RATE_NOT_FOUND',
  /** No registered rate publisher quotes the requested target currency. params: `currency`, `supportedCurrencies` (comma-separated). */
  'EXCHANGE_RATE_CURRENCY_UNSUPPORTED',
  /** The submitted reporting currency is not a valid ISO 4217 code. params: `currency`. */
  'REPORTING_CURRENCY_INVALID',
  /** The reporting currency is valid but no registered publisher supports it. params: `currency`, `supportedCurrencies` (comma-separated). */
  'REPORTING_CURRENCY_UNSUPPORTED',

  // ── AI (#3865) ──
  /** The AI provider named in the path is not one OpenLinker knows. params: `provider`, `allowedProviders` (comma-separated). */
  'AI_PROVIDER_UNKNOWN',
  /** The active AI provider takes no API key, so there is no key to set. params: `provider`. */
  'AI_PROVIDER_KEY_NOT_APPLICABLE',
  /** The AI provider cannot be activated because no API key is configured. params: `provider`, `envVarName` (when the provider has one). */
  'AI_PROVIDER_KEY_MISSING',
  /** The AI provider call failed; its own words are in `providerMessage`. No params. */
  'AI_COMPLETION_FAILED',
  /** No published prompt template for this key and channel. params: `key`, `channel` (`master` for the master channel). */
  'PROMPT_TEMPLATE_NOT_PUBLISHED',
  /** No prompt template matches. params (each only when known): `templateId`, `key`, `channel`, `version`. */
  'PROMPT_TEMPLATE_NOT_FOUND',
  /** A published prompt template cannot be archived. params: `templateId`, `key`, `channel` (absent for master). */
  'PROMPT_TEMPLATE_PUBLISHED_NOT_ARCHIVABLE',
  /** The prompt template is not in the state the action needs. params: `templateId`, `requiredState`, `actualState` (when known). */
  'PROMPT_TEMPLATE_STATE_INVALID',
  /** Rendering the prompt template needs a variable that was not supplied. params: `variable`. */
  'PROMPT_TEMPLATE_VARIABLE_MISSING',

  // ── Automation (#3865) ──
  /** No automation run has this id. params: `runId`. */
  'AUTOMATION_RUN_NOT_FOUND',
  /** No automation rule has this id. params: `ruleId`. */
  'AUTOMATION_RULE_NOT_FOUND',
  /** A dry run named neither a rule nor a draft to evaluate. No params. */
  'AUTOMATION_DRY_RUN_RULE_MISSING',
  /** Arming a rule with irreversible actions needs `moneyAcknowledged: true`. params: `actions` (comma-separated action kinds). */
  'AUTOMATION_MONEY_ACK_REQUIRED',
  /** The automation run cannot be run again. params: `reason` (`not-failed` | `rule-deleted` | `subject-unsupported` | `superseded` | `retry-exhausted`). */
  'AUTOMATION_RETRY_REFUSED',

  // ── Content (#3865) ──
  /** The content field changed on the channel or master since the draft was read. params: `productId`, `fieldKey`, `connectionId` (absent for master). */
  'CONTENT_CONFLICT',
  /** No content field row for this product, channel and field. params: `productId`, `fieldKey`, `connectionId` (absent for master). */
  'CONTENT_FIELD_NOT_FOUND',
  /** The description is empty once narrowed to what the destination accepts. params: `productId`, `connectionId`. */
  'CONTENT_EMPTY_AFTER_DESCRIPTION_FORMAT',
  /** The product has no offers linked on this channel to publish content to. params: `productId`, `connectionId`. */
  'CONTENT_NO_LINKED_OFFERS',

  // ── Mappings (#3865) ──
  /** The chosen processor connection cannot act as this kind of processor. params: `processorConnectionId`, `processorKind`. */
  'ROUTING_PROCESSOR_INCOMPATIBLE',
  /** Two fulfilment routing rules name the same source delivery method. params: `sourceDeliveryMethodId`. */
  'ROUTING_RULE_DUPLICATE',
  /** A routing rule's parcel profile is invalid. params: `sourceDeliveryMethodId`. */
  'ROUTING_PARCEL_PROFILE_INVALID',
  /** No attribute mapping rule has this id. params: `ruleId` (when the request named one). */
  'ATTRIBUTE_MAPPING_RULE_NOT_FOUND',
  /** The connection has no source connection paired to it for the mappings page. params: `connectionId`, `connectionName`. */
  'MAPPING_SOURCE_NOT_PAIRED',
  /** More than one source connection is paired to this connection. params: `connectionId`, `connectionName`, `pairedConnectionIds` (comma-separated). */
  'MAPPING_SOURCE_PAIRING_AMBIGUOUS',
  /** The connection lacks the capability one side of the mappings page needs. params: `connectionId`, `connectionName`, `capability`. */
  'MAPPING_SIDE_CAPABILITY_UNSUPPORTED',

  // ── Products (#3865) ──
  /** No product variant has this id. params: `variantId`. */
  'PRODUCT_VARIANT_NOT_FOUND',
  /** The product has no image at this index, or the shop did not serve it. params: `productId`, `index`. */
  'PRODUCT_IMAGE_NOT_FOUND',
  /** The variant has no image at this index, or the shop did not serve it. params: `variantId`, `index`. */
  'PRODUCT_VARIANT_IMAGE_NOT_FOUND',
  /** The submitted variant cost (amount or currency) is invalid. No params. */
  'PRODUCT_VARIANT_COST_INVALID',

  // ── Listings (#3865) ──
  /** No shop-publish creation record has this id. params: `recordId`. */
  'LISTING_CREATION_RECORD_NOT_FOUND',
  /** No offer creation record has this id on this connection. params: `recordId`. */
  'OFFER_CREATION_RECORD_NOT_FOUND',
  /** No offer mapping has this id (or it is not an offer mapping). params: `mappingId`. */
  'OFFER_MAPPING_NOT_FOUND',
  /** The marketplace does not return this offer. params: `externalOfferId`, `connectionId`. */
  'MARKETPLACE_OFFER_NOT_FOUND',
  /** The marketplace gave no live status for this offer. params: `externalOfferId`, `connectionId`. */
  'OFFER_LIVE_STATUS_UNAVAILABLE',
  /** The marketplace has no category with this id. params: `categoryId`, `connectionId`. */
  'MARKETPLACE_CATEGORY_NOT_FOUND',
  /** The marketplace catalogue has no product with this id. params: `productId`, `connectionId`. */
  'CATALOG_PRODUCT_NOT_FOUND',
  /** A bulk submission resolved to no products or variants. No params. */
  'BULK_SUBMISSION_EMPTY',
  /** No bulk offer creation batch has this id. params: `batchId`. */
  'BULK_OFFER_BATCH_NOT_FOUND',
  /** No bulk shop-publish batch has this id. params: `batchId`. */
  'BULK_SHOP_PUBLISH_BATCH_NOT_FOUND',
  /** Another submit with the same idempotency key is still being resolved; retry. No params. */
  'BULK_SUBMIT_IDEMPOTENCY_CONTENDED',
  /** Every selected variant is already listed on the connection. params: `skippedCount`. */
  'BULK_VARIANTS_ALREADY_LISTED',
  /** No selected variant has stock synced from the master catalogue yet. params: `skippedCount`. */
  'BULK_MASTER_STOCK_NOT_SYNCED',
  /** A variant's EAN/GTIN has an invalid check digit. params: `variantId`, `ean`. */
  'BULK_EAN_INVALID',
  /** One EAN/GTIN is shared by several included variants. params: `ean`, `variantIds` (comma-separated). */
  'BULK_EAN_DUPLICATE',
  /** An override's price currency differs from the batch currency. params: `overrideKey`, `overrideCurrency`, `batchCurrency`. */
  'BULK_CURRENCY_MISMATCH',
  /** An override map holds a key that is not an internal variant id. params: `field`, `key`. */
  'BULK_OVERRIDE_KEY_INVALID',
  /** The submission expands to more offers than one batch allows. params: `expandedCount`, `ceiling`. */
  'BULK_OFFER_CEILING_EXCEEDED',
  /** The batch has no failed children to retry. params: `batchId`. */
  'BULK_RETRY_NOTHING_FAILED',
  /** A bulk batch record has no request snapshot to retry from (invariant violation). params: `recordId`, `batchId`. */
  'BULK_RETRY_SNAPSHOT_MISSING',
  /** No price change episode has this id. params: `episodeId`. */
  'PRICE_CHANGE_NOT_FOUND',
  /** The price change episode is already resolved. params: `episodeId`. */
  'PRICE_CHANGE_ALREADY_RESOLVED',
  /** The price change episode changed since it was read. params: `episodeId`, `expectedVersion`, `currentVersion`. */
  'PRICE_CHANGE_STALE',
  /** The price change episode cannot be reopened: a newer one exists for its key. params: `episodeId`. */
  'PRICE_CHANGE_SUPERSEDED',
  /** Another request is resolving the price change episode. params: `episodeId`. */
  'PRICE_CHANGE_IN_FLIGHT',
  /** The manual price override is outside the allowed bound. params: `episodeId`, `outcome` (`too-high` | `too-low`), `attempted`, `computedAmount`, `limit`. */
  'PRICE_CHANGE_OVERRIDE_OUT_OF_RANGE',
  /** The price change episode is blocked and cannot be accepted. params: `episodeId`, `blockReason`. */
  'PRICE_CHANGE_BLOCKED',

  // ── Auth (#3865) ──
  /** Login refused because the account's email is not confirmed yet. */
  'AUTH_EMAIL_NOT_CONFIRMED',
  /** Login refused; deliberately does not say which credential was wrong. */
  'AUTH_INVALID_CREDENTIALS',
  /** The refresh request carried no refresh cookie. */
  'AUTH_REFRESH_TOKEN_MISSING',
  /** The refresh token is unknown. */
  'AUTH_REFRESH_TOKEN_INVALID',
  /** The refresh token has expired. */
  'AUTH_REFRESH_TOKEN_EXPIRED',
  /** A rotated refresh token was presented again; the session chain was revoked. */
  'AUTH_REFRESH_TOKEN_REUSED',
  /** The signed-in user was deleted since the token was issued. */
  'AUTH_USER_NO_LONGER_EXISTS',
  /** The caller's role may not do this. params: `requiredRole` where one role is named. */
  'INSUFFICIENT_PERMISSIONS',
  /** A cookie-authenticated write carried no CSRF token. */
  'CSRF_TOKEN_MISSING',
  /** The CSRF header does not match the CSRF cookie. */
  'CSRF_TOKEN_MISMATCH',
  /** Self-service registration is turned off on this installation. */
  'REGISTRATION_DISABLED',
  /** The username or email is taken; never says which (#3156). */
  'REGISTRATION_IDENTIFIER_TAKEN',
  /** Too many registration attempts from this address. */
  'REGISTRATION_RATE_LIMITED',
  /** A demo account must accept session recording (also sent by the consent guard since #1882). */
  'ANALYTICS_CONSENT_REQUIRED',
  /** The email confirmation link is invalid, used or expired. */
  'EMAIL_CONFIRMATION_LINK_INVALID',
  /** Too many confirmation emails requested from this address. */
  'EMAIL_CONFIRMATION_RATE_LIMITED',
  /** The password reset token is invalid or expired. */
  'PASSWORD_RESET_TOKEN_INVALID',
  /** The new password does not meet the strength rules. */
  'PASSWORD_TOO_WEAK',

  // ── Users (#3865) ──
  /** No user has this id. params: `userId`. */
  'USER_NOT_FOUND',
  /** An admin-created account's username or email is taken. params: `field` (`username` | `email`). */
  'USER_IDENTIFIER_TAKEN',
  /** The user is not awaiting approval. params: `userId`. */
  'USER_NOT_PENDING',
  /** The user is not active, so cannot be deactivated. params: `userId`. */
  'USER_NOT_ACTIVE',
  /** The user is not deactivated, so cannot be reactivated. params: `userId`. */
  'USER_NOT_DEACTIVATED',
  /** An admin may not change their own role or status, or delete themselves. */
  'USER_CANNOT_MODIFY_SELF',
  /** The change would leave the installation with no admin. */
  'USER_LAST_ADMIN',

  // ── Login page settings (#3865) ──
  /**
   * A login page settings value is refused: an unknown field or language, or a
   * value over the field's limit. params: `field` (dotted path, e.g. `pl.headline`).
   */
  'LOGIN_PAGE_SETTING_INVALID',

  // ── Integrations (#3865) ──
  /** Another pricing & sync update for the connection is running. params: `connectionId`. */
  'PRICING_SYNC_UPDATE_IN_PROGRESS',
  /** The pricing & sync settings changed since the page loaded. params: `connectionId`. */
  'PRICING_SYNC_STALE',
  /** The connection cannot receive a pricing rule (not a publishing destination). params: `connectionId`, `adapterKey`. */
  'PRICING_RULE_DESTINATION_UNSUPPORTED',
  /** The OAuth callback carried no state parameter. */
  'OAUTH_STATE_MISSING',
  /** The platform refused the authorization code. params: `platformType`. */
  'OAUTH_CODE_EXCHANGE_REJECTED',
  /** Exchanging the authorization code failed for a non-provider reason. params: `platformType`. */
  'OAUTH_CODE_EXCHANGE_FAILED',
  /** The authorized account's identity could not be read. params: `platformType`. */
  'OAUTH_ACCOUNT_IDENTITY_FAILED',
  /** No OAuth-completion adapter is registered for the adapter key. params: `adapterKey`. */
  'OAUTH_ADAPTER_NOT_REGISTERED',
  /** Re-authorizing a connection of another platform. params: `connectionId`, `expectedPlatformType`, `platformType`. */
  'OAUTH_CONNECTION_PLATFORM_MISMATCH',
  /** The OAuth credentials could not be stored. */
  'CREDENTIALS_STORE_FAILED',
  /** The connection is not a Subiekt Invoicing connection. params: `connectionId`. */
  'CONNECTION_NOT_SUBIEKT_INVOICING',
  /** The platform rotates its webhook secret itself; it cannot be set by hand. params: `platformType`. */
  'WEBHOOK_SECRET_NOT_CALLER_SUPPLIED',
  /** No Allegro quantity command with this id on the connection. params: `commandId`, `connectionId`. */
  'ALLEGRO_COMMAND_NOT_FOUND',

  // ── Webhooks (#3865) ──
  /** The request reached the webhook route without its raw body. */
  'WEBHOOK_RAW_BODY_MISSING',
  /** The webhook body is larger than allowed. params: `maxBytes`, `actualBytes`. */
  'WEBHOOK_PAYLOAD_TOO_LARGE',
  /** The provider path segment is malformed. */
  'WEBHOOK_PROVIDER_INVALID',
  /** The connection id path segment is not a UUID. */
  'WEBHOOK_CONNECTION_ID_INVALID',
  /** The delivery authenticated but its body could not be read. params: `provider`, `connectionId`. */
  'WEBHOOK_BODY_UNREADABLE',
  /** The delivery's signature or authentication failed. params: `provider`, `connectionId`. */
  'WEBHOOK_AUTHENTICATION_FAILED',
  /** The delivery was a replay or carried a stale timestamp. params: `provider`, `connectionId`. */
  'WEBHOOK_REPLAY_REJECTED',
  /** Routing the delivery failed transiently; the source should retry. params: `provider`, `connectionId`. */
  'WEBHOOK_ROUTING_UNAVAILABLE',
  /** The target connection is unknown or disabled. params: `provider`, `connectionId`. */
  'WEBHOOK_TARGET_UNAVAILABLE',
  /** No webhook delivery has this id. params: `deliveryId`. */
  'WEBHOOK_DELIVERY_NOT_FOUND',

  // ── Sync (#3865) ──
  /** No sync job has this id. params: `jobId`. */
  'SYNC_JOB_NOT_FOUND',
  /** No sync job was created for this webhook event. params: `platformType`, `connectionId`, `eventId`. */
  'SYNC_JOB_NOT_FOUND_FOR_EVENT',
  /** The job could not be enqueued. params: `jobType`, `connectionId`. */
  'SYNC_JOB_ENQUEUE_FAILED',
  /** The job is not in a retryable state. params: `jobId`, `field`, `value`. */
  'SYNC_JOB_NOT_RETRYABLE',

  // ── MCP, cursors, catalog trust, operational settings (#3865) ──
  /** No MCP token has this id. params: `tokenId`. */
  'MCP_TOKEN_NOT_FOUND',
  /** No cursor with this key on the connection. params: `cursorKey`, `connectionId`. */
  'CURSOR_NOT_FOUND',
  /** The connection is unknown or has no ProductMaster capability. params: `connectionId`. */
  'CATALOG_TRUST_CONNECTION_NOT_FOUND',
  /** An operational setting is out of bounds. params: `field`. */
  'OPERATIONAL_SETTING_INVALID',

  // ── OMS (#3865) ──
  /** The connection is not the OpenLinker OMS, so it has no sourcing rules or router. params: `connectionId`, `platformType`. */
  'CONNECTION_NOT_OMS',
  /** A sourcing rule's kind/name/after-action combination is not valid. params: `kind`, `name`, `afterAction`. */
  'SOURCING_RULE_INVALID',
  /** A stored sourcing rule uses a combination this version does not understand; delete and recreate it. params: `kind`, `name`, `afterAction`. */
  'SOURCING_RULE_NOT_UNDERSTOOD',
  /** priorityLocationIds was set on a rule that does not read it. params: `name`, `prioritySortName`. */
  'SOURCING_RULE_PRIORITY_LOCATIONS_UNUSED',
  /** effectiveTo is not after effectiveFrom. */
  'SOURCING_RULE_WINDOW_INVALID',
  /** A priority sort names locations that do not exist. params: `locationIds` (comma-separated). */
  'SOURCING_RULE_LOCATION_NOT_FOUND',
  /** No sourcing rule with this id on the connection. params: `connectionId`, `ruleId`. */
  'SOURCING_RULE_NOT_FOUND',
  /** The connection already has a live rule of this kind and name. params: `connectionId`, `kind`, `name`. */
  'SOURCING_RULE_DUPLICATE',
  /** A reorder did not name every active rule exactly once. params: `connectionId`, `missingRuleIds`, `unknownRuleIds` (comma-separated). */
  'SOURCING_RULE_REORDER_MISMATCH',
  /** No fulfilment router is available for the connection. params: `connectionId`. */
  'ROUTING_ROUTER_UNAVAILABLE',
  /** The router cannot evaluate an unsaved ruleset. params: `connectionId`. */
  'ROUTING_DRAFT_UNSUPPORTED',
  /** Draft rule ids repeat. params: `ruleIds` (comma-separated). */
  'ROUTING_DRAFT_RULE_IDS_DUPLICATE',
  /** Draft rules the router cannot evaluate. params: `ruleIds` (comma-separated). */
  'ROUTING_DRAFT_RULES_INVALID',
  /** A dry run needs exactly one of an order id or a basket. */
  'ROUTING_DRY_RUN_SUBJECT_INVALID',
  /** The order is not fully ingested, so it cannot be routed. params: `orderId`. */
  'ROUTING_ORDER_NOT_READY',
  /** The order has no shipping address to route to. params: `orderId`. */
  'ROUTING_ORDER_NO_SHIPPING_ADDRESS',

  // ── Fiscalization (#3865) ──
  /** The order snapshot cannot be read for a fiscal registration. params: `orderId`. */
  'FISCAL_ORDER_DETAILS_UNAVAILABLE',
  /** A fiscal registration was requested without an idempotency key. */
  'FISCAL_IDEMPOTENCY_KEY_MISSING',
  /** The order's lines cannot be composed into a registrable sale. */
  'FISCAL_LINE_INVALID',
  /** The order's price treatment cannot be registered. */
  'FISCAL_PRICE_TREATMENT_UNSUPPORTED',
  /** No fiscal registration record has this id. */
  'FISCAL_REGISTRATION_NOT_FOUND',
  /** The provider could not be asked about an in-doubt registration; retry. params: `recordId`, `connectionId`. */
  'FISCAL_RECONCILE_CHECK_FAILED',
  /** The registration is not in doubt, so there is nothing to reconcile. */
  'FISCAL_REGISTRATION_NOT_IN_DOUBT',
  /** Another registration or issue for the order is running; retry. params: `orderId`. */
  'FISCAL_REGISTRATION_CONTENDED',
  /** The latest attempt is unfinished but its job already ended, so asking again would change nothing. params: `orderId`, `recordId`. */
  'FISCAL_REGISTRATION_NOT_RESTARTABLE',

  // ── Sales documents (#3865) ──
  /** The connection lacks the capability the document kind needs. params: `connectionId`, `capability`, `documentKind`. */
  'SALES_DOCUMENT_CONNECTION_CAPABILITY_DISABLED',
  /** No curated starter template for the country. params: `country`. */
  'SALES_DOCUMENT_TEMPLATE_NOT_FOUND',
  /** Adopting a template without a connection for one of its slots. params: `slot`. */
  'SALES_DOCUMENT_TEMPLATE_SLOT_UNSELECTED',
  /** No delivery-line suggestion for the country. params: `country`. */
  'DELIVERY_LINE_SUGGESTION_NOT_FOUND',
  /** A submitted rule condition lacks a valid value. params: `field`, `property`. */
  'SALES_DOCUMENT_CONDITION_INVALID',
  /** A rule condition is malformed. params: `conditionIndex`. */
  'SALES_DOCUMENT_CONDITION_MALFORMED',
  /** A rule with identical conditions already routes this country in an overlapping period. params: `ruleId`, `connectionId`. */
  'SALES_DOCUMENT_RULE_CONFLICT',
  /** The country already has a rule or default, so it cannot be acknowledged as unconfigured. params: `country`. */
  'SALES_DOCUMENT_COUNTRY_ALREADY_CONFIGURED',
  /** No sales-document threshold is registered for the ref. params: `thresholdRef`. */
  'SALES_DOCUMENT_THRESHOLD_NOT_FOUND',
  /** No sales-document rule has this id. params: `ruleId`. */
  'SALES_DOCUMENT_RULE_NOT_FOUND',
  /** No country default has this id. params: `defaultId`. */
  'SALES_DOCUMENT_COUNTRY_DEFAULT_NOT_FOUND',

  // ── Fulfillment authority (#3865) ──
  /** Applying the preset would leave an authority ambiguous; nothing changed. params: `presetId`, `ambiguityCount`. */
  'AUTHORITY_PRESET_AMBIGUOUS',
  /** The preset is not available on this installation. params: `presetId`, `unavailableReason` (when known). */
  'AUTHORITY_PRESET_UNAVAILABLE',

  // ── Global filters (#3863) ──
  /** The adapter does not support this capability. params: `adapterKey`, `capability`. */
  'CAPABILITY_NOT_SUPPORTED',
  /** The capability is switched off on this connection. params: `connectionId`, `adapterKey`, `capability`. */
  'CAPABILITY_NOT_ENABLED',
  /** The connection is disabled or archived. params: `connectionId`, `status`. */
  'CONNECTION_DISABLED',
  /** Another connection still points at this one. params: `connectionId`, `reason`; `referrers` lists them. */
  'CONNECTION_IN_USE',
  /** The connection has no category tree to read. params: `connectionId`. */
  'TAXONOMY_SOURCE_UNAVAILABLE',
  /** Available stock could not be read, so nothing was published. params: `connectionId`, `internalVariantId`. */
  'AVAILABILITY_UNKNOWN',
  /** The platform connection is busy; nothing was sent. params: `retryAfterSeconds`. */
  'PLATFORM_CONNECTION_BUSY',
  /** Another location already has this code. params: `code`. */
  'INVENTORY_LOCATION_CODE_DUPLICATE',
  /** Stock positions still name the location. params: `locationId`, `positionCount`. */
  'INVENTORY_LOCATION_IN_USE',
  /** The owning connection does not exist. params: `ownerConnectionId`. */
  'INVENTORY_LOCATION_OWNER_NOT_FOUND',
  /** No variant has this id. params: `productVariantId`. */
  'INVENTORY_VARIANT_NOT_FOUND',
  /** No return has this id. params: `returnId`. */
  'RETURN_NOT_FOUND',
  /** The return is not matched to an order yet. params: `trigger`. */
  'RETURN_NOT_ATTRIBUTED',
  /** The return's source cannot decline returns. params: `returnId`, `sourceConnectionId`. */
  'RETURN_DECLINE_UNSUPPORTED',
  /** The decline request is missing what the source needs. params: `field`. */
  'RETURN_DECLINE_INVALID',
  /** No such line on the return. params: `lineId`. */
  'RETURN_LINE_NOT_FOUND',
  /** The line's custody state refuses this act. params: `reason`. */
  'RETURN_CUSTODY_TRANSITION_REFUSED',
  /** Someone else is changing this line; retry. params: `lineId`. */
  'RETURN_CUSTODY_CONTENDED',
  /** A restock of this line is already blocked. params: `reason`. */
  'RETURN_RESTOCK_ALREADY_BLOCKED',
  /** The line has no blocked restock to attest. params: `lineId`. */
  'RETURN_RESTOCK_ATTESTATION_INVALID',
  /** The return cannot be authorized. params: `reason`. */
  'RETURN_AUTHORIZE_REFUSED',
  /** The return cannot be matched to this order. params: `reason`. */
  'RETURN_MATCH_REFUSED',
  /** The return cannot be recorded. params: `reason`. */
  'RETURN_RECORD_REFUSED',
  /** The refund cannot be triggered. params: `reason`. */
  'RETURN_REFUND_BLOCKED',
  /** Someone else is refunding this return; retry. params: `returnId`. */
  'RETURN_REFUND_CONTENDED',
  /** The refund observation is refused. params: `returnId`. */
  'RETURN_REFUND_OBSERVATION_INVALID',
  /** The action cannot follow this trigger. params: `trigger`, `action`, `index`. */
  'AUTOMATION_TRIGGER_ACTION_ILLEGAL',
  /** The condition field is not offered for this trigger. params: `trigger`, `field`, `index`. */
  'AUTOMATION_CONDITION_FIELD_ILLEGAL',
  /** The trigger settings are refused. params: `trigger`. */
  'AUTOMATION_TRIGGER_CONFIG_INVALID',
  /** A condition is refused. params: `index`. */
  'AUTOMATION_CONDITION_INVALID',
  /** An action step is refused. params: `index`. */
  'AUTOMATION_ACTION_INVALID',
  /** The rule has too few or too many steps. params: `count`, `min`, `max`. */
  'AUTOMATION_STEP_COUNT_INVALID',
  /** An identical rule exists. params: `trigger`, `conflictingRuleId`. */
  'AUTOMATION_RULE_CONFLICT',

  // ── Codes sent before the registry, kept verbatim (#3863) ──
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_ALREADY_CANCELLED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_ALREADY_SHIPPED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_HAS_FISCAL_RECEIPT',
  /** Order cancellation or correction refusal (sent in `error`). */
  'INVOICE_NOT_SETTLED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_CANCEL_IN_FLIGHT',
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_WORK_ACCEPTED_NEEDS_ACK',
  /** Order cancellation or correction refusal (sent in `error`). */
  'ORDER_CANCEL_CONTENDED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'LABEL_NOT_VOIDABLE',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CHANNEL_REFUSED_CANCEL',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CHANGE_ALREADY_CONFIRMED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CHANGE_EXPIRED',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CHANGE_NOT_OPEN',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CHANGE_KIND_NOT_CONFIRMABLE',
  /** Order cancellation or correction refusal (sent in `error`). */
  'CORRECTION_SUPERSEDED',
  /** Order edit refusal (sent in `error` and `code`). */
  'ORDER_AMENDMENT_IN_FLIGHT',
  /** Order edit refusal (sent in `error` and `code`). */
  'ORDER_NOT_READY',
  /** Order edit refusal (sent in `error` and `code`). */
  'ORDER_PACKED',
  /** Order edit refusal (sent in `error` and `code`). */
  'LABEL_ALREADY_BOUGHT',
  /** Order edit refusal (sent in `error` and `code`). */
  'SALES_DOCUMENT_ISSUED',
  /** Order edit refusal (sent in `error` and `code`). */
  'QUANTITY_ONLY_DECREASES',
  /** Order edit refusal (sent in `error` and `code`). */
  'QUANTITY_BELOW_FULFILLED',
  /** Order edit refusal (sent in `error` and `code`). */
  'ORDER_WOULD_BE_EMPTY',
  /** Order edit refusal (sent in `error` and `code`). */
  'EDIT_AFTER_HANDOFF',
  /** Order edit refusal (sent in `error` and `code`). */
  'ADDRESS_EDIT_NEEDS_PII_STORAGE',
  /** Order edit refusal (sent in `error` and `code`). */
  'ORDER_EDIT_CONTENDED',
  /** Order edit refusal (sent in `error` and `code`). */
  'NOTHING_CHANGED',
  /** Order edit refusal (sent in `error` and `code`). */
  'LINE_PRICE_NOT_RESOLVABLE',
  /** Order edit refusal (sent in `error` and `code`). */
  'DISCOUNT_EXCEEDS_TOTAL',
  /** Order edit refusal (sent in `error` and `code`). */
  'DISCOUNT_BELOW_REFUNDED',
  /** The order already has an open hold. */
  'ORDER_ALREADY_ON_HOLD',
  /** The hold was released already. */
  'HOLD_ALREADY_RELEASED',
  /** Someone else is changing the order's hold; retry. */
  'ORDER_HOLD_CONTENDED',
  /** The order has no buyer note to mark read. */
  'NO_BUYER_NOTE',
  /** The order is not held by routing. */
  'ROUTING_RETRY_NOT_HELD',
  /** The routing hold cannot be retried; it clears by itself. */
  'ROUTING_RETRY_NOT_RETRYABLE',
  /** No router is available to retry with. */
  'ROUTING_RETRY_NO_ROUTER',
  /** Test fixtures are switched off on this install. */
  'TEST_FIXTURES_DISABLED',
  /** Issuing the correction failed. */
  'CORRECTION_FAILED',
  /** The channel refused the content; `errors` lists why. */
  'CHANNEL_PUBLISH_FAILED',
  /** The export range is wider than one file allows. */
  'EXPORT_RANGE_TOO_WIDE',
  /** The current password is wrong. */
  'CURRENT_PASSWORD_INCORRECT',
  /** The new password equals the current one. */
  'PASSWORD_UNCHANGED',
  /** The user has set their own password already. */
  'ALREADY_SET_OWN_PASSWORD',
  /** The one-time password must be changed first. */
  'PASSWORD_CHANGE_REQUIRED',
  /** The authorized account is not the connection's account. */
  'OAUTH_ACCOUNT_MISMATCH',
  /** The authorization state is invalid or expired. */
  'OAUTH_STATE_INVALID',
  /** The refund is above what the order can still refund. */
  'refund_ceiling_exceeded',
  /** The refund ceiling could not be read; nothing was refunded. */
  'refund_ceiling_unavailable',
  /** Someone else is recording a refund of this order; retry. */
  'refund_record_contended',
  /** The refund lock could not be taken; nothing was recorded. */
  'refund_lock_unavailable',
  /** The fulfilment task changed since it was read; re-read and retry. */
  'version_conflict',
  /** The action is not allowed in the task's current state. */
  'action_not_legal',
  /** The stock change is large and needs confirming. */
  'confirmation-required',
  /** Someone else is correcting this stock; retry. */
  'contended',
  /** Document email refusal. */
  'document-not-found',
  /** Document email refusal. */
  'not-issued',
  /** Document email refusal. */
  'document-not-ready',
  /** Document email refusal. */
  'no-document',
  /** Document email refusal. */
  'no-recipient',
  /** Document email refusal. */
  'invalid-recipient',
  /** Document email refusal. */
  'mailer-unavailable',
  /** Document email refusal. */
  'send-failed',
  /** Stock correction refusal. */
  'no-inventory-master',
  /** Stock correction refusal. */
  'ambiguous-inventory-master',
  /** Stock correction refusal. */
  'no-position',
  /** Stock correction refusal. */
  'unattributed-owner',
  /** Stock correction refusal. */
  'adapter-unresolved',
  /** Stock correction refusal. */
  'master-refused',
  /** Stock correction refusal. */
  'master-product-not-found',
  /** Stock correction refusal. */
  'master-unreadable',
  /** Stock correction refusal. */
  'no-change',
  /** Stock correction refusal. */
  'insufficient-stock',
  /** Stock correction refusal. */
  'note-required',
  /** Stock correction refusal. */
  'invalid-quantity',
  /** Stock correction refusal. */
  'idempotency-key-reused',
] as const;

export type KnownApiErrorCode = (typeof ApiErrorCodeValues)[number];

/** The fallback for an error with no code of its own: `HTTP_404`, `HTTP_409` ... */
export type HttpStatusErrorCode = `HTTP_${number}`;

export type ApiErrorCode = KnownApiErrorCode | HttpStatusErrorCode;

export function httpStatusErrorCode(status: number): HttpStatusErrorCode {
  return `HTTP_${status}`;
}
