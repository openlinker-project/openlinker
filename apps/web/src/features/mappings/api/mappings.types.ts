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

/** A single option for a source/target dropdown. */
export interface MappingOption {
  value: string;
  label: string;
}

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

// ── Mapping options bundle ────────────────────────────────────────────────

export interface MappingOptions {
  allegroOrderStatuses: MappingOption[];
  allegroDeliveryMethods: MappingOption[];
  allegroPaymentProviders: MappingOption[];
  prestashopOrderStatuses: MappingOption[];
  prestashopCarriers: MappingOption[];
  prestashopPaymentModules: MappingOption[];
}
