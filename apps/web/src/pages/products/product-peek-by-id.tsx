/**
 * ProductPeekById (#4026 follow-up)
 *
 * One product's peek, opened by id from somewhere other than the products list:
 * an order line in the order peek opens it on top, so the operator never leaves
 * `/orders`. The product is read in the same list shape the products page rows
 * carry (stock aggregates, listings coverage - the `productId` filter), and the
 * view is assembled by the same `useProductCells` the list uses, so the two
 * peeks cannot disagree. There is nothing to step through, so the panel is
 * "1 of 1".
 *
 * Publishing works as it does on the list: one destination goes straight to the
 * wizard, more than one opens the destination picker.
 *
 * @module apps/web/src/pages/products
 */
import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../shared/i18n';
import { Button } from '../../shared/ui/button';
import { EmptyState, ErrorState, LoadingState } from '../../shared/ui/feedback-state';
import { useWriteAccess } from '../../shared/auth/use-permission';
import { useDemoMode } from '../../features/system';
import { useProductsQuery } from '../../features/products/hooks/use-products-query';
import { OfferProductPickerModal } from '../../features/listings/components/offer-product-picker-modal';
import { ProductPeek } from './product-peek';
import { useProductCells } from './use-product-cells';

export interface ProductPeekByIdProps {
  /** The product to show; `null` keeps the panel closed. */
  productId: string | null;
  onClose: () => void;
}

const NO_STEP = (): void => {};

export function ProductPeekById({ productId, onClose }: ProductPeekByIdProps): ReactElement {
  const copy = useMessages('products').productsListPage.peek;
  const navigate = useNavigate();
  const write = useWriteAccess('listings:write', useDemoMode());
  const { publishDestinations, buildPeekView } = useProductCells();
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = useProductsQuery(
    productId ? { productId } : undefined,
    { limit: 1, offset: 0 },
    undefined,
    { enabled: productId !== null }
  );
  const product = productId ? query.data?.items.find((p) => p.id === productId) : undefined;

  const publish = useCallback(
    (id: string): void => {
      if (publishDestinations.length === 1) {
        const params = new URLSearchParams({
          productIds: id,
          connectionId: publishDestinations[0]!.connection.id,
        });
        void navigate(`/listings/bulk-create/wizard?${params.toString()}`);
      } else if (publishDestinations.length > 1) {
        setPickerOpen(true);
      }
    },
    [publishDestinations, navigate]
  );

  const view = product
    ? buildPeekView(product, {
        onPublish: write.visible ? publish : undefined,
        canCreateOffers: write.visible,
      })
    : null;

  const placeholder = query.isLoading ? (
    <LoadingState liveRegion="off" title={copy.loadingTitle} message={copy.loadingMessage} />
  ) : query.error ? (
    <ErrorState
      title={copy.loadError}
      message={query.error.message}
      action={<Button onClick={() => void query.refetch()}>{copy.retry}</Button>}
    />
  ) : (
    <EmptyState title={copy.notFoundTitle} message={copy.notFound} />
  );

  return (
    <>
      <ProductPeek
        view={view}
        open={productId !== null}
        stacked
        placeholder={placeholder}
        position={1}
        count={1}
        onNavigate={NO_STEP}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      />
      {product ? (
        <OfferProductPickerModal
          isOpen={pickerOpen}
          onClose={() => {
            setPickerOpen(false);
          }}
          initialProductIds={[product.id]}
          initialProductMeta={[product]}
        />
      ) : null}
    </>
  );
}
