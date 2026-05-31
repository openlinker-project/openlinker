/**
 * Mapping Domain Types
 *
 * Input types for upsert operations on connection-scoped mapping tables.
 *
 * @module libs/core/src/mappings/domain/types
 */

import type { OrderStatus } from '@openlinker/core/orders';

export interface StatusMappingInput {
  allegroStatus: string;
  prestashopStatusId: string;
}

export interface CarrierMappingInput {
  allegroDeliveryMethodId: string;
  prestashopCarrierId: string;
}

/**
 * Override item for the outbound OL→destination order-state mapping (#862).
 * `externalStateId` is the destination platform's native state id as a string
 * (PrestaShop: numeric order-state id).
 */
export interface OrderStateMappingInput {
  olStatus: OrderStatus;
  externalStateId: string;
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
