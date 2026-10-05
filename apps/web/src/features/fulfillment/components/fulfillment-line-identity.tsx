/**
 * A fulfilment line as a product card (#3096)
 *
 * The order page's `OrderLineItemIdentity` — thumbnail, name, codes — plus the
 * variant's attributes, for one line of a fulfilment task. It replaced a bare
 * `ol_variant_<32 hex>` on the task detail and on the order page's fulfilment
 * panel: an operator recognises a product by its name and picture and checks
 * a shelf against its SKU and EAN, not against an internal id.
 *
 * ## The picture is fetched with the session's token
 *
 * `line.imageUrl` is the API's own proxy path, behind the ordinary route
 * guard, so it is fetched as a blob (`useAuthenticatedImage`, as the bench's
 * `BenchThumb` does) and handed to the thumbnail as an object URL. Loading,
 * failed and absent all render the thumbnail's letter placeholder, so the row
 * keeps its height either way.
 *
 * ## Absent facts are absent
 *
 * A variant the catalogue does not know still renders — its raw id, muted, in
 * the code slot — because the line is real even when its product is not, and
 * an operator can act on "this id is missing from the catalogue". Nothing is
 * invented in its place.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { useCallback, type ReactElement } from 'react';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useAuthenticatedImage } from '../../../shared/hooks/use-authenticated-image';
import { formatVariantAttributes } from '../../../shared/lib/variant-attributes';
import { OrderLineItemIdentity } from '../../orders';
import type { FulfillmentTaskLine } from '../api/fulfillment.types';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

const LINE_COPY = FULFILLMENT_WORK_DETAIL_COPY.lines;

export interface FulfillmentLineIdentityProps {
  line: FulfillmentTaskLine;
  /**
   * The line's attributes, already narrowed to those that tell it apart from
   * the task's other lines (`narrowAttributes`), or `null` for none.
   */
  attributes: Record<string, string> | null;
  thumbnailSize?: 'sm' | 'md';
}

export function FulfillmentLineIdentity({
  line,
  attributes,
  thumbnailSize = 'md',
}: FulfillmentLineIdentityProps): ReactElement {
  const apiClient = useApiClient();
  // Memoised, or the hook's effect re-runs on every render and re-fetches the
  // same picture — its dependency list includes the fetcher.
  const fetchImage = useCallback((path: string) => apiClient.requestBlob(path), [apiClient]);
  const image = useAuthenticatedImage(line.imageUrl ?? null, fetchImage);

  const name = line.productName ?? null;
  const sku = line.sku ?? null;
  const ean = line.ean ?? null;
  const codes = [
    sku === null ? null : `${LINE_COPY.skuLabel} ${sku}`,
    ean === null ? null : `${LINE_COPY.eanLabel} ${ean}`,
  ].filter((part): part is string => part !== null);

  return (
    <OrderLineItemIdentity
      className="fulfilment-line-identity"
      name={name}
      code={codes.length > 0 ? codes.join(' · ') : line.productVariantId}
      codeIsFallback={codes.length === 0}
      imageSrc={image.status === 'ready' ? image.objectUrl : null}
      placeholderName={name ?? sku ?? line.productVariantId}
      thumbnailSize={thumbnailSize}
      extra={
        attributes === null ? null : (
          <span className="fulfilment-line-identity__attributes">
            {formatVariantAttributes(attributes)}
          </span>
        )
      }
    />
  );
}
