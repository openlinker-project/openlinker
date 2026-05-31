/**
 * Mappings Feature Types
 *
 * Frontend transport types for the mappings API. Mirrors the backend
 * mapping response DTOs and option list contracts.
 *
 * @module apps/web/src/features/mappings/api
 */

export interface StatusMapping {
  id: string;
  connectionId: string;
  allegroStatus: string;
  prestashopStatusId: string;
}

export interface CarrierMapping {
  id: string;
  connectionId: string;
  allegroDeliveryMethodId: string;
  prestashopCarrierId: string;
}

export interface PaymentMapping {
  id: string;
  connectionId: string;
  allegroPaymentProvider: string;
  prestashopPaymentModule: string;
}

/**
 * Outbound OL→destination order-state override (#862). `externalStateId` is
 * the destination platform's native state id (PrestaShop: numeric, as a string).
 */
export interface OrderStateMapping {
  id: string;
  connectionId: string;
  olStatus: string;
  externalStateId: string;
}

/**
 * Behaviour discriminator for a single `MappingOption` (#517). Mirrors the
 * BE `MappingOption.kind` field. `'dynamic'` means the option's shipping
 * cost (or analogous behaviour) is computed at runtime by an external
 * module — e.g. the OpenLinker PS Dynamic carrier reads buyer-paid
 * shipping from the sidecar table at order-total time (#516). Static
 * options omit `kind`.
 */
export const MappingOptionKindValues = ['dynamic'] as const;
export type MappingOptionKind = (typeof MappingOptionKindValues)[number];

/** A single option for a source/target dropdown. */
export interface MappingOption {
  value: string;
  label: string;
  /**
   * Behaviour discriminator. See {@link MappingOptionKindValues}. The FE
   * uses this to decorate dropdown options (e.g. label suffix or muted
   * tag); runtime routing is handled BE-side.
   */
  kind?: MappingOptionKind;
}

/**
 * Which adapter side serves the option list.
 * - `destination` resolves the OrderProcessorManager adapter (e.g. PrestaShop)
 * - `source` resolves the OrderSource adapter (e.g. Allegro)
 */
export const MappingSideValues = ['source', 'destination'] as const;
export type MappingSide = (typeof MappingSideValues)[number];

/**
 * Option-list kind — which list the FE is asking the BE to populate. Not
 * every (side, kind) combo is valid — the API returns 404 for unsupported
 * pairs:
 *   destination: carriers | order-statuses | payment-methods
 *   source:      order-statuses | delivery-methods | payment-methods
 *
 * Renamed from the previous `MappingOptionKind` (#517) to disambiguate
 * from `MappingOption.kind` (per-option behaviour discriminator above).
 */
export const MappingOptionListKindValues = [
  'carriers',
  'order-statuses',
  'payment-methods',
  'delivery-methods',
] as const;
export type MappingOptionListKind = (typeof MappingOptionListKindValues)[number];

// ── Upsert payloads ──────────────────────────────────────────────────────

export interface UpsertStatusMappingsPayload {
  items: { allegroStatus: string; prestashopStatusId: string }[];
}

export interface UpsertCarrierMappingsPayload {
  items: { allegroDeliveryMethodId: string; prestashopCarrierId: string }[];
}

export interface UpsertPaymentMappingsPayload {
  items: { allegroPaymentProvider: string; prestashopPaymentModule: string }[];
}

export interface UpsertOrderStateMappingsPayload {
  items: { olStatus: string; externalStateId: string }[];
}

/**
 * Canonical OpenLinker order statuses (#862) — the fixed source axis for the
 * OL→destination order-state mapping panel. Mirrors the BE `OrderStatusValues`
 * union; hand-kept in sync under the FE-001 hand-written-contract strategy.
 */
export const OL_ORDER_STATUS_OPTIONS: MappingOption[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

// ── Category mapping types ────────────────────────────────────────────────

export interface AllegroCategory {
  id: string;
  name: string;
  parentId: string | null;
  leaf: boolean;
}

export interface PrestashopCategory {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  active: boolean;
}

export interface CategoryMapping {
  id: string;
  connectionId: string;
  prestashopCategoryId: string;
  allegroCategoryId: string;
  allegroCategoryName: string;
  allegroCategoryPath: string | null;
}

export interface UpsertCategoryMappingPayload {
  allegroCategoryId: string;
  allegroCategoryName: string;
  allegroCategoryPath?: string;
}

// ── Fulfillment routing (#836) ─────────────────────────────────────────────

/** Mirrors the backend `FulfillmentProcessorKind` (`@openlinker/core/mappings`). */
export const FulfillmentProcessorKindValues = [
  'omp_fulfilled',
  'ol_managed_carrier',
  'source_brokered',
] as const;
export type FulfillmentProcessorKind = (typeof FulfillmentProcessorKindValues)[number];

/** A persisted routing rule — a source delivery method diverted away from the PS default. */
export interface RoutingRule {
  id: string;
  sourceConnectionId: string;
  sourceDeliveryMethodId: string;
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string;
}

export interface RoutingRuleInput {
  sourceDeliveryMethodId: string;
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string;
}

export interface UpsertRoutingRulesPayload {
  items: RoutingRuleInput[];
}

/** A processor a delivery method may be routed to (from the candidates endpoint). */
export interface CandidateProcessor {
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string;
}

// ── Mapping options bundle ────────────────────────────────────────────────

export interface MappingOptions {
  allegroOrderStatuses: MappingOption[];
  allegroDeliveryMethods: MappingOption[];
  allegroPaymentProviders: MappingOption[];
  prestashopOrderStatuses: MappingOption[];
  prestashopCarriers: MappingOption[];
  prestashopPaymentModules: MappingOption[];
}
