/**
 * Bulk listing wizard page (#740)
 *
 * Route entry point — hydrates the selected products + their variants from
 * `?productIds=` and mounts the `BulkWizard` controller. An optional
 * `?variantIds=` param (#1754) is threaded to the wizard as the pre-checked
 * set: a product with some of its variants in the set still seeds ALL its
 * variants (staying a multi-variant, expandable row) but only the set members
 * start included; a product with no match keeps every variant included
 * (whole-product pick). Handles the boundary states before the wizard can
 * render:
 *   - empty productIds  → redirect back to /products
 *   - >100 productIds   → redirect back to /products with an alert
 *
 * An optional `?fromBatch=` param (#2234) marks the load as a recovery of a
 * failed bulk batch; it is forwarded to the wizard for its resuming banner and
 * is never read by the submit path.
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
import { usePlural, useMessages } from '../../shared/i18n';
import { BulkWizard } from '../../features/listings/components/bulk/bulk-wizard';
import { MAX_WIZARD_PRODUCTS } from '../../features/listings/lib/batch-recovery';
import { useConnectionsQuery } from '../../features/connections';
import { useProductsBatchQuery } from '../../features/products';
import type { Product } from '../../features/products';
import { serverErrorText } from '../../features/listings/lib/server-error-text';

/**
 * Shared with the batch-recovery helpers (#2234) so the failed-batch "Fix and
 * resubmit" action disables itself at the same cap this route enforces,
 * instead of routing into a redirect.
 */
const MAX_PRODUCTS = MAX_WIZARD_PRODUCTS;

export function BulkCreateWizardPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const copy = useMessages('listings').bulkCreateWizardPage;
  const common = useMessages('listings').common;
  const plural = usePlural();

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
        title={copy.redirectingTitle}
        message={copy.redirectingMessage}
      />
    );
  }

  const isLoading = productQueries.some((q) => q.isLoading);
  const failed = productQueries.find((q) => q.error);

  if (isLoading) {
    return (
      <LoadingState
        title={copy.loadingTitle}
        message={plural(ids.length, copy.loadingMessage)}
      />
    );
  }

  if (failed?.error) {
    return (
      <ErrorState
        title={copy.errorTitle}
        message={serverErrorText(common.serverSaid, failed.error.message, common.unknownError)}
        action={
          <Button
            onClick={() => {
              productQueries.forEach((q) => {
                void q.refetch();
              });
            }}
          >
            {copy.retry}
          </Button>
        }
      />
    );
  }

  const products: Product[] = productQueries
    .map((q) => q.data)
    .filter((p): p is Product => p !== undefined);

  if (products.length === 0) {
    return (
      <ErrorState
        title={copy.emptyTitle}
        message={copy.emptyMessage}
      />
    );
  }

  return (
    <BulkWizard
      products={products}
      preSelectedVariantIds={selectedVariantIds}
      preselectedConnectionId={searchParams.get('connectionId') ?? undefined}
      resumedFromBatchId={searchParams.get('fromBatch') ?? undefined}
      resolveConnectionName={(connectionId) =>
        connectionsQuery.data?.find((c) => c.id === connectionId)?.name ??
        connectionId
      }
    />
  );
}
