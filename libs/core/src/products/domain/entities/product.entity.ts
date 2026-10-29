/**
 * Product Domain Entity
 *
 * Represents a canonical product in the OpenLinker system. Products are stored
 * with internal IDs only; external identifiers live in IdentifierMapping.
 * This entity is integration-agnostic and represents the single source of truth
 * for product data.
 *
 * Shape note: this is an `interface` (not a `class`) deliberately. Products cross
 * adapter → repository → application → UI boundaries and are constructed in
 * several places (adapter mappers, repo `toDomain`, test factories). Structural
 * typing avoids `instanceof` false negatives across import paths and lets
 * repositories build plain objects without a constructor call. Adapters and
 * drafts may omit `createdAt`/`updatedAt` — the repo fills them on load.
 *
 * @module libs/core/src/products/domain/entities
 */

import type { ProductGpsr } from '../types/product-gpsr.types';
import type { TaxRateUnknownReason } from '../types/tax-rate.types';
export interface Product {
  id: string;
  name: string;
  sku: string | null;
  /**
   * GROSS catalogue price: what a buyer pays in the master connection's sales
   * country, in `currency`, excluding promotions (ADR-077). A master whose
   * platform stores net converts inside its own adapter, with its own rate and
   * rounding; core never applies a rate. `null` means the master could not state
   * a gross figure - never a net one standing in for it, because every consumer
   * (marketplace offers, shop publishers, price-change detection) reads it as
   * gross.
   */
  price: number | null;
  description: string | null;
  images: string[] | null;
  /**
   * ISO 4217 currency code resolved at sync time by the master adapter.
   * Null when the adapter did not provide a currency (e.g., before a per-connection
   * currency setting is configured). Persisted on the products table.
   */
  currency: string | null;
  /** Populated by the repository on load; adapters/drafts may omit. */
  createdAt?: Date;
  /** Populated by the repository on load; adapters/drafts may omit. */
  updatedAt?: Date;
  /** Master-derived, not persisted on the products table. */
  weight?: number;
  /** Master-derived (external category IDs), not persisted on the products table. */
  categories?: string[];
  /**
   * Master-derived full category path (root→leaf), each node carrying the
   * source-shop category id + name (#1096, F3). A richer companion to the bare
   * `categories` ids: a destination that accepts shop-native taxonomy (Erli
   * `source:"shop"`) emits this as a breadcrumb, and the product page shows it.
   * Absent/unset ⇒ the master could not resolve a path (falls back to the
   * bare-id `categories`). Persisted on the `products.categoryBreadcrumb` jsonb
   * column.
   */
  categoryBreadcrumb?: { id: string; name: string }[];
  /**
   * Master-derived product features (e.g. `{ name: 'Material', value: 'Ceramic' }`),
   * distinct from variant-distinguishing attributes (#1096, F2). A destination
   * that accepts shop-native attributes (Erli `source:"shop"` `externalAttributes`)
   * emits these. Absent/empty ⇒ no features. Persisted on the `products.features`
   * jsonb column (#1752).
   */
  features?: { name: string; value: string }[];
  /**
   * Neutral tax-rate code the ProductMaster stated (#2054), or `null` when it
   * stated none. Persisted on the products table, written only by the tax read.
   */
  taxRate?: string | null;
  /** ISO 3166-1 alpha-2 the rate was resolved against. Provenance only. */
  taxRateCountry?: string | null;
  /**
   * When the master was last asked. `null` means NEVER - which is a different
   * fact from "asked, and has no rate", and the only thing that tells them
   * apart.
   */
  taxRateReadAt?: Date | null;
  /**
   * Why the master named no rate (#2264), when it named none. Provenance only -
   * nothing gates on it. `null` means no reason was recorded, which is NOT
   * `not-configured` (a real answer the shop gave).
   */
  taxRateUnknownReason?: TaxRateUnknownReason | null;
  /**
   * What the master stated about the product under the EU General Product
   * Safety Regulation (producer, responsible person, importer, safety
   * information) - by value, never by a platform id. Persisted on the
   * `products.gpsr` jsonb column.
   *
   * Three states, kept apart by the repository: `undefined` means the master
   * did not report GPSR on this read (it does not model it, or its reference
   * read failed) and leaves the stored value untouched; `null` means it reported
   * that the product carries none; an object is what it stated.
   */
  gpsr?: ProductGpsr | null;
}
