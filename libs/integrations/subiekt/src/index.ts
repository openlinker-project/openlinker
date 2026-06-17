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
