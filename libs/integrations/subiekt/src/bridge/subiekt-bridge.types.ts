/**
 * Subiekt Bridge — wire types
 *
 * Request/response shapes for the OpenLinker Subiekt Bridge REST surface — the
 * Windows .NET service that wraps InsERT's Sfera SDK (#728 §3.1). These are
 * **bridge-native** (Subiekt/PL dialect: `nip`, KSeF regulatory states) — the
 * neutral ⇄ bridge mapping lives in the real adapter (#753), NOT here. The
 * authoritative REST contract is owned by the bridge bootstrap issue (#752);
 * these shapes are the TS expression of it and may be reconciled when #752
 * lands — the shared contract suite is where divergence surfaces.
 *
 * @module libs/integrations/subiekt/bridge
 */

/**
 * KSeF-native regulatory status the bridge reports for a document. The neutral
 * `RegulatoryStatus` (`@openlinker/core/invoicing`) is derived from this by the
 * #753 adapter — it is not referenced here.
 */
export const BridgeRegulatoryStatusValues = [
  'none',
  'pending',
  'sent',
  'accepted',
  'rejected',
] as const;
export type BridgeRegulatoryStatus = (typeof BridgeRegulatoryStatusValues)[number];

/** Bridge-side issuance result state. */
export const BridgeInvoiceStateValues = ['issued', 'failed'] as const;
export type BridgeInvoiceState = (typeof BridgeInvoiceStateValues)[number];

/** Postal address as the bridge expects it. */
export interface BridgeAddress {
  line1: string;
  line2: string | null;
  city: string;
  postalCode: string;
  countryCode: string;
}

/** Buyer (kontrahent) in the bridge's dialect — `nip` is provider-native here. */
export interface BridgeBuyer {
  name: string;
  nip: string | null;
  address: BridgeAddress;
  isCompany: boolean;
}

/** One invoice line in the bridge request. */
export interface BridgeLine {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
}

/**
 * Issue-invoice request. `documentType` is a provider-native string (the bridge
 * resolves it to a Subiekt document kind); #752 owns the well-known values.
 */
export interface BridgeIssueInvoiceRequest {
  orderId: string;
  idempotencyKey?: string;
  documentType: string;
  currency: string;
  buyer: BridgeBuyer;
  lines: BridgeLine[];
}

/** Issue-invoice response. */
export interface BridgeIssueInvoiceResponse {
  providerInvoiceId: string;
  providerInvoiceNumber: string;
  state: BridgeInvoiceState;
  regulatoryStatus: BridgeRegulatoryStatus;
  pdfUrl: string | null;
}

/** Customer (kontrahent) upsert request. */
export interface BridgeUpsertCustomerRequest {
  buyer: BridgeBuyer;
}

/** Customer upsert response — the provider's customer id. */
export interface BridgeUpsertCustomerResponse {
  providerCustomerId: string;
}

/** Status-read request, keyed by the provider's invoice id. */
export interface BridgeInvoiceStatusRequest {
  providerInvoiceId: string;
}

/** Status-read response. */
export interface BridgeInvoiceStatusResponse {
  state: BridgeInvoiceState;
  regulatoryStatus: BridgeRegulatoryStatus;
}
