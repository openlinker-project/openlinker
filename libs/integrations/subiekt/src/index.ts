/**
 * @openlinker/integrations-subiekt — public barrel
 *
 * The Subiekt bridge contract (#754): the wire types, error shapes, and the
 * `SubiektBridgeClient` interface OpenLinker's Subiekt adapter (#753) codes
 * against. The in-memory test double lives on the `/testing` sub-barrel.
 *
 * @module libs/integrations/subiekt
 */
export type { SubiektBridgeClient } from './bridge/subiekt-bridge.client';
export {
  SubiektBridgeUnreachableError,
  SubiektRejectedError,
} from './bridge/subiekt-bridge.errors';
export {
  BridgeRegulatoryStatusValues,
  BridgeInvoiceStateValues,
} from './bridge/subiekt-bridge.types';
export type {
  BridgeRegulatoryStatus,
  BridgeInvoiceState,
  BridgeAddress,
  BridgeBuyer,
  BridgeLine,
  BridgeIssueInvoiceRequest,
  BridgeIssueInvoiceResponse,
  BridgeUpsertCustomerRequest,
  BridgeUpsertCustomerResponse,
  BridgeInvoiceStatusRequest,
  BridgeInvoiceStatusResponse,
} from './bridge/subiekt-bridge.types';

// --- #753 invoicing adapter ---------------------------------------------------

// Plugin descriptor + static manifest
export { createSubiektPlugin, subiektAdapterManifest } from './subiekt-plugin';

// Host wiring
export { SubiektIntegrationModule } from './subiekt-integration.module';

// Adapter + real transport (consumed by tests / host)
export { SubiektInvoicingAdapter, SUBIEKT_PROVIDER_TYPE } from './infrastructure/adapters/subiekt-invoicing.adapter';
export {
  SubiektBridgeHttpClient,
  SUBIEKT_BRIDGE_ENDPOINTS,
} from './infrastructure/http/subiekt-bridge-http.client';

// Config / credentials types
export type { SubiektConnectionConfig } from './domain/types/subiekt-connection-config.types';
export type { SubiektBridgeCredentials } from './domain/types/subiekt-credentials.types';

// Domain exceptions
export { SubiektConfigException } from './domain/exceptions/subiekt-config.exception';
export { SubiektInvoiceRejectedError } from './domain/exceptions/subiekt-invoice-rejected.exception';
export { SubiektBridgeTransportError } from './domain/exceptions/subiekt-bridge-transport.exception';
export type { SubiektTransportRetryability } from './domain/types/subiekt-transport-retryability.types';
export { SubiektUnsupportedDocumentTypeError } from './domain/exceptions/subiekt-unsupported-document-type.exception';
export { SubiektBridgeAuthError } from './domain/exceptions/subiekt-bridge-auth.exception';

// NOTE: SubiektBridgeUnreachableWithPhaseError stays UNEXPORTED — client-private.
