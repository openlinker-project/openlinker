/**
 * WooCommerce Provisioner Types
 *
 * Wire shapes and method-input contracts for the WooCommerce customer + address
 * provisioners. WooCommerce stores billing / shipping addresses INLINE on the
 * customer resource (no standalone address entity), so the "address" shapes here
 * reuse the adapter's `WooCommerceOrderAddress` (the same nested billing /
 * shipping object), and the update request is a partial customer PUT carrying
 * one or both of them.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { Address } from '@openlinker/core/orders';
import type { AddressType, CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { WooCommerceOrderAddress } from '../adapters/order-processor/woocommerce-order.types';
import type { IWooCommerceHttpClient } from '../http/woocommerce-http-client.interface';

/**
 * A WooCommerce customer resource as returned by `GET /customers/{id}`,
 * including its inline billing / shipping addresses (used by the address
 * provisioner's hash-match recovery path).
 */
export interface WooCommerceCustomerWithAddressesResponse {
  id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  billing?: WooCommerceOrderAddress;
  shipping?: WooCommerceOrderAddress;
}

/**
 * Partial customer PUT body carrying one or both inline addresses.
 */
export interface WooCommerceCustomerAddressUpdateRequest {
  billing?: WooCommerceOrderAddress;
  shipping?: WooCommerceOrderAddress;
}

/**
 * Input for {@link WooCommerceCustomerProvisioner.resolveOrCreateCustomer}.
 */
export interface ResolveOrCreateCustomerInput {
  /** Internal OL customer id (undefined for a guest source order). */
  readonly internalCustomerId: string | undefined;
  /** Validated buyer email (undefined when unavailable — forces guest). */
  readonly buyerEmail: string | undefined;
  readonly firstName: string;
  readonly lastName: string;
  readonly connectionId: string;
  readonly httpClient: IWooCommerceHttpClient;
  readonly identifierMapping: IdentifierMappingPort;
}

/**
 * Input for {@link WooCommerceAddressProvisioner.resolveOrCreateAddress}.
 */
export interface ResolveOrCreateAddressInput {
  readonly internalCustomerId: string;
  /** The resolved WC customer id. Guest (`<= 0`) short-circuits with `null`. */
  readonly wcCustomerId: number;
  readonly address: Address | undefined;
  readonly addressType: AddressType;
  readonly connectionId: string;
  readonly httpClient: IWooCommerceHttpClient;
  readonly customerProjectionRepository: CustomerProjectionRepositoryPort;
}
