/**
 * Sales Documents — DI Tokens (#2170)
 *
 * `sales-documents` gains its first Symbol-tokened bindings here — the
 * documented `<ctx>.tokens.ts`-exemption (`docs/engineering-standards.md §
 * Symbol DI Token Re-export Convention`) applied only while this concern had
 * no service, repository, or port to inject; #2170 adds all three, so the
 * exemption ends and this file exists per the standard rule every other
 * context follows.
 *
 * @module libs/core/src/sales-documents
 */
export const SALES_DOCUMENT_RULE_REPOSITORY_TOKEN = Symbol('SalesDocumentRuleRepositoryPort');
export const SALES_DOCUMENT_COUNTRY_DEFAULT_REPOSITORY_TOKEN = Symbol(
  'SalesDocumentCountryDefaultRepositoryPort',
);
export const SALES_DOCUMENT_THRESHOLD_REPOSITORY_TOKEN = Symbol(
  'SalesDocumentThresholdRepositoryPort',
);
export const SALES_DOCUMENT_COUNTRY_ACKNOWLEDGMENT_REPOSITORY_TOKEN = Symbol(
  'SalesDocumentCountryAcknowledgmentRepositoryPort',
);
export const SALES_DOCUMENT_RULES_SERVICE_TOKEN = Symbol('ISalesDocumentRulesService');
export const DOCUMENT_EMAIL_DELIVERY_REPOSITORY_TOKEN = Symbol(
  'DocumentEmailDeliveryRepositoryPort',
);
export const DOCUMENT_EMAIL_DELIVERY_SERVICE_TOKEN = Symbol('IDocumentEmailDeliveryService');
/** Told when an order's originating sales document is issued (#3554). Bound by the orders context. */
export const SALES_DOCUMENT_ISSUED_LISTENER_TOKEN = Symbol('SalesDocumentIssuedListenerPort');
