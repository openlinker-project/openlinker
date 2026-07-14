/**
 * WooCommerce Provisioner Types
 *
 * Wire shapes for the WooCommerce customer + address provisioners. WooCommerce
 * stores billing / shipping addresses INLINE on the customer resource (no
 * standalone address entity), so the "address" shapes here are the nested
 * `billing` / `shipping` objects of a WC customer, and the update request is a
 * partial customer PUT carrying one or both of them.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/provisioners
 */

/**
 * A WooCommerce customer billing / shipping address object. All fields are
 * optional because a source order may omit them; nullish fields are OMITTED
 * from the wire payload (WC REST type-checks address properties as strings).
 */
export interface WooCommerceCustomerAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  phone?: string;
  email?: string;
}

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
  billing?: WooCommerceCustomerAddress;
  shipping?: WooCommerceCustomerAddress;
}

/**
 * Partial customer PUT body carrying one or both inline addresses.
 */
export interface WooCommerceCustomerAddressUpdateRequest {
  billing?: WooCommerceCustomerAddress;
  shipping?: WooCommerceCustomerAddress;
}
