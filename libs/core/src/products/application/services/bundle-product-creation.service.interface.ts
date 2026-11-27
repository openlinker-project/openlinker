/**
 * Bundle Product Creation Service Interface (#3935)
 *
 * @module libs/core/src/products/application/services
 */
import type { ProductCreationMode } from '../../domain/ports/capabilities/product-creator.capability';

export interface BundleCreationTarget {
  connectionId: string;
  connectionName: string;
  platformType: string;
  /** `null` when this master cannot create products from OpenLinker. */
  creationMode: ProductCreationMode | null;
}

export interface CreateBundleProductInput {
  /** The product master connection the new product is created in. */
  connectionId: string;
  name: string;
  sku: string;
  /** Gross price of the whole set. */
  price: number;
  currency?: string;
  ean?: string;
  description?: string;
  /** A component variant whose tax rate the set's price includes (the rate is read from OpenLinker, never typed). */
  rateSourceVariantId?: string;
}

export interface CreatedBundleProduct {
  productId: string;
  variantId: string;
  name: string;
  sku: string;
  /** True when a product with this SKU already existed at the master and was adopted. */
  adopted: boolean;
}

export interface IBundleProductCreationService {
  /** Every ProductMaster connection, with whether it can create a product. */
  listTargets(): Promise<BundleCreationTarget[]>;

  /**
   * Creates the product at the master, maps it and pulls it into OpenLinker so
   * it has a variant a bundle definition can be written for. A retry with the
   * same SKU adopts the product the first attempt made instead of creating a
   * second one.
   */
  createBundleProduct(input: CreateBundleProductInput): Promise<CreatedBundleProduct>;
}
