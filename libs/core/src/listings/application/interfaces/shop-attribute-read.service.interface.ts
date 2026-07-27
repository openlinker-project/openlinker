/**
 * Shop Attribute Read Service Interface (#1835)
 *
 * Contract for the core read service that returns a shop connection's store-wide
 * global product attributes and their predefined terms. Implemented by
 * `ShopAttributeReadService`; consumed by the HTTP layer so the FE publish edit
 * flow can render a structured attribute picker (choose a global attribute, then
 * pick from its terms) for a shop destination that supports it, with free-text
 * custom attributes as the fallback.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { ShopAttribute, ShopAttributeTerm } from '@openlinker/core/listings';

export interface IShopAttributeReadService {
  /**
   * Return the store-wide global attributes for a shop connection.
   *
   * Resolves the connection's `ProductPublisher` adapter, narrows it to the
   * `ShopAttributeReader` sub-capability, and returns the live attributes.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the connection's
   *   adapter does not implement `ProductPublisher` at all.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter supports
   *   `ProductPublisher` but does not implement the attribute reader.
   */
  listAttributes(connectionId: string): Promise<ShopAttribute[]>;

  /**
   * Return the predefined terms of one global attribute for a shop connection.
   * Resolution + error semantics mirror {@link listAttributes}.
   */
  listAttributeTerms(connectionId: string, attributeId: string): Promise<ShopAttributeTerm[]>;
}
