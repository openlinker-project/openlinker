/**
 * Bulk listing wizard page (#740)
 *
 * Route entry point — hydrates the selected products + their variants from
 * `?productIds=` and mounts the `BulkWizard` controller. When an optional
 * `?variantIds=` param is present (#1754), each hydrated product is narrowed
 * to the selected variant subset before the wizard seeds it; a product with
 * no matching entry keeps all its variants (whole-product pick). Handles the
 * three boundary states before the wizard can render:
 *   - empty productIds  → redirect back to /products
 *   - >100 productIds   → redirect back to /products with an alert
 *   - loading           → LoadingState
 *   - product-fetch errors → ErrorState with retry
 *
 * @module apps/web/src/pages/listings
 */
import { useEffect, useMemo, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  ErrorState,
  LoadingState,
} from '../../shared/ui';
import { BulkWizard } from '../../features/listings/components/bulk/bulk-wizard';
import { useConnectionsQuery } from '../../features/connections';
import { useProductsBatchQuery } from '../../features/products';
import type { Product } from '../../features/products';

const MAX_PRODUCTS = 100;

/**
 * Narrow each product to the selected variant subset (#1754). For a product
 * with ≥1 of its variants in `variantIds`, return a copy whose `variants` is
 * filtered to that subset; a product with no match is returned unchanged
 * (whole-product pick → the wizard seeds all its variants). An empty set
 * returns the products unchanged (byte-identical to the `/products` path).
 */
export function filterProductsToSelectedVariants(
  products: Product[],
  variantIds: Set<string>,
): Product[] {
  if (variantIds.size === 0) return products;
  return products.map((product) => {
    const variants = product.variants ?? [];
    const matching = variants.filter((v) => variantIds.has(v.id));
    if (matching.length === 0) return product;
    return { ...product, variants: matching };
  });
}

export function BulkCreateWizardPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const ids = useMemo<string[]>(() => {
    const raw = searchParams.get('productIds') ?? '';
    if (raw.trim() === '') return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [searchParams]);

  // Redirect if no IDs or over the cap. Effect ensures we don't render
  // the wizard for an invalid load.
  useEffect(() => {
    if (ids.length === 0 || ids.length > MAX_PRODUCTS) {
      void navigate('/products', { replace: true });
    }
  }, [ids, navigate]);

  const selectedVariantIds = useMemo<Set<string>>(() => {
    const raw = searchParams.get('variantIds') ?? '';
    if (raw.trim() === '') return new Set();
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
  }, [searchParams]);

  const productQueries = useProductsBatchQuery(ids, {
    enabled: ids.length > 0 && ids.length <= MAX_PRODUCTS,
  });

  const connectionsQuery = useConnectionsQuery();

  if (ids.length === 0 || ids.length > MAX_PRODUCTS) {
    return (
      <LoadingState
        title="Redirecting…"
        message="Returning you to the Products page."
      />
    );
  }

  const isLoading = productQueries.some((q) => q.isLoading);
  const failed = productQueries.find((q) => q.error);

  if (isLoading) {
    return (
      <LoadingState
        title="Loading products"
        message={`Fetching details for ${ids.length.toLocaleString()} selected products…`}
      />
    );
  }

  if (failed?.error) {
    return (
      <ErrorState
        title="Could not load selected products"
        message={failed.error.message}
        action={
          <Button
            onClick={() => {
              productQueries.forEach((q) => {
                void q.refetch();
              });
            }}
          >
            Retry
          </Button>
        }
      />
    );
  }

  const hydratedProducts: Product[] = productQueries
    .map((q) => q.data)
    .filter((p): p is Product => p !== undefined);
  const products = filterProductsToSelectedVariants(hydratedProducts, selectedVariantIds);

  if (products.length === 0) {
    return (
      <ErrorState
        title="No products found"
        message="None of the selected product IDs resolved. Return to /products and try again."
      />
    );
  }

  return (
    <BulkWizard
      products={products}
      preselectedConnectionId={searchParams.get('connectionId') ?? undefined}
      resolveConnectionName={(connectionId) =>
        connectionsQuery.data?.find((c) => c.id === connectionId)?.name ??
        connectionId
      }
    />
  );
}
