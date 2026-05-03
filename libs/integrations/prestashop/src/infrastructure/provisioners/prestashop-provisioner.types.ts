/**
 * PrestaShop Provisioner Types
 *
 * Type definitions for PrestaShop provisioning operations. These types represent
 * data structures returned from and sent to the PrestaShop WebService API.
 *
 * @module libs/integrations/prestashop/src/infrastructure/provisioners
 */

/**
 * PrestaShop Customer Data
 *
 * Represents customer data returned from PrestaShop WebService API.
 */
export interface PrestashopCustomer {
  id: string;
  email?: string;
  is_guest?: string | number;
}

/**
 * PrestaShop Customer Creation Data
 *
 * Data structure for creating a new customer in PrestaShop.
 */
export interface PrestashopCustomerCreate {
  is_guest: number;
  passwd: string;
  firstname: string;
  lastname: string;
  email: string;
  active: number;
  id_shop?: number;
  id_shop_group?: number;
  /**
   * Customer's default group id (#505). When omitted, PS defaults to 0,
   * which orphans the customer from any carrier with group restrictions.
   * The provisioner sets this from `connection.config.guestCustomerGroupId`
   * (default: 2 — PS's stock "Guest" group).
   */
  id_default_group?: number;
  /**
   * PS WS associations block (#505). Group membership is populated from
   * `associations.groups.group[]` at create time — `id_default_group`
   * alone doesn't add the row to `ps_customer_group`. The double-nested
   * shape matches the established PS WS JSON convention used by
   * `PrestashopOrderMapper.mapOrderCreate` for `order_rows`.
   */
  associations?: {
    groups?: { group?: Array<{ id: number }> };
  };
  [key: string]: unknown;
}

/**
 * PrestaShop Address Data
 *
 * Represents address data returned from PrestaShop WebService API.
 */
export interface PrestashopAddress {
  id: string;
  id_customer?: string | number;
  id_country?: string | number;
  alias?: string;
  firstname?: string;
  lastname?: string;
  address1?: string;
  address2?: string;
  city?: string;
  postcode?: string;
  phone?: string;
}

/**
 * PrestaShop Address Creation Data
 *
 * Data structure for creating a new address in PrestaShop.
 */
export interface PrestashopAddressCreate {
  id_customer: number;
  id_country: number;
  alias: string;
  firstname: string;
  lastname: string;
  address1: string;
  address2?: string;
  city: string;
  postcode?: string;
  phone?: string;
  [key: string]: unknown;
}

/**
 * PrestaShop Country Data
 *
 * Represents country data returned from PrestaShop WebService API.
 */
export interface PrestashopCountry {
  id: string;
  iso_code?: string;
  active?: string | number; // '1' or 1 for active, '0' or 0 for inactive
}

/**
 * PrestaShop Currency Data
 *
 * Represents currency data returned from PrestaShop WebService API.
 */
export interface PrestashopCurrency {
  id: string;
  iso_code?: string;
}
