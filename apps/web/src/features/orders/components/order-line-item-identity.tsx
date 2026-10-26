/**
 * Order line item identity (#3096)
 *
 * What a line item IS, at a glance: a thumbnail, the product name, a mono code
 * line (SKU, or the best stand-in id), and optional further lines beneath it —
 * EAN, the variant's attributes. Extracted from `OrderLineItemsPanel`'s
 * Product cell so the fulfilment task detail and the order page's fulfilment
 * panel render a product the way the order page already does, rather than as
 * a bare `ol_variant_…` id.
 *
 * ## The picture is resolved by the caller
 *
 * `imageSrc` is a URL the `<img>` can load as-is. The order snapshot carries
 * one; a fulfilment line carries the API's own guarded proxy path, which needs
 * the bearer token and is turned into an object URL by the caller
 * (`useAuthenticatedImage`). Taking the resolved source keeps this component
 * free of the API client and usable from both.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement, ReactNode } from 'react';

import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';

export interface OrderLineItemIdentityProps {
  /** The product's display name. Absent renders no name line, never a placeholder. */
  name?: string | null;
  /** The mono second line — a SKU, or a stand-in id when there is none. */
  code: ReactNode;
  /** `code` is an internal stand-in rather than a code a person would know — rendered muted. */
  codeIsFallback?: boolean;
  /** A source the `<img>` can load directly, or nothing for the letter placeholder. */
  imageSrc?: string | null;
  /** Feeds the thumbnail's placeholder letter. */
  placeholderName: string;
  thumbnailSize?: 'sm' | 'md';
  /** Further lines under the code line. */
  extra?: ReactNode;
  className?: string;
}

export function OrderLineItemIdentity({
  name,
  code,
  codeIsFallback = false,
  imageSrc,
  placeholderName,
  thumbnailSize = 'sm',
  extra,
  className = '',
}: OrderLineItemIdentityProps): ReactElement {
  return (
    <span className={['order-line-item__product', className].filter(Boolean).join(' ')}>
      <ProductThumbnail name={placeholderName} src={imageSrc ?? undefined} size={thumbnailSize} />
      <span className="order-line-item__product-info">
        {name ? <span className="order-line-item__name">{name}</span> : null}
        <span
          className={['order-line-item__sku', 'mono-text', codeIsFallback ? 'text-muted' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {code}
        </span>
        {extra}
      </span>
    </span>
  );
}
