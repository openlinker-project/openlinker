/**
 * Mapping Domain Types
 *
 * Input types for upsert operations on connection-scoped mapping tables.
 *
 * @module libs/core/src/mappings/domain/types
 */

export interface StatusMappingInput {
  allegroStatus: string;
  prestashopStatusId: string;
}

export interface CarrierMappingInput {
  allegroDeliveryMethodId: string;
  prestashopCarrierId: string;
}

export interface PaymentMappingInput {
  allegroPaymentProvider: string;
  prestashopPaymentModule: string;
}

export interface CategoryMappingInput {
  prestashopCategoryId: string;
  allegroCategoryId: string;
  allegroCategoryName: string;
  allegroCategoryPath?: string;
}
