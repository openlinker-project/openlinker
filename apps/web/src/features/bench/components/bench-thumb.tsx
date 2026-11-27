/**
 * The item picture at the bench (#3340 follow-up)
 *
 * All three bench surfaces — the desktop hero, the item table, the phone
 * dock — showed the item's picture as a bare `<img>` that branched only on
 * `imageUrl === null`. A url that was PRESENT but did not load therefore left
 * a blank box: the packer sees an empty square and cannot tell "this item has
 * no photo" from "the photo did not arrive", and neither tells them what the
 * thing in their hand should look like.
 *
 * That is not hypothetical here. `products.images[]` stores the url the SYNC
 * used to reach the shop, which on any deployment where the shop is reachable
 * only from the backend network — every Docker-compose install, the demo
 * included — is a host the browser cannot resolve at all. `/products/:id/images/:index`
 * (the API-side proxy) fixes the url; this fixes what the packer sees when a
 * picture is missing for any other reason, which no proxy can prevent.
 *
 * Deliberately NOT `shared/ui/ProductThumbnail`: each of the three slots
 * carries its own class and its own size, set by the bench's own CSS against
 * the mockup, and that primitive owns its markup and its `.product-thumbnail`
 * sizing. This keeps the class the caller passes and adds only the missing
 * behaviour.
 *
 * The letter is decorative — `aria-hidden`, with no `alt` on the image —
 * because the item's name is rendered immediately beside it at all three
 * sites. Announcing it twice is noise to a screen reader, not information.
 *
 * @module apps/web/src/features/bench/components
 */
import { useCallback, type ReactElement } from 'react';

import { useApiClient } from '../../../app/api/api-client-provider';
import { AuthenticatedImage } from '../../../shared/ui/authenticated-thumbnail';

export interface BenchThumbProps {
  /** The bench class for this slot — hero swatch, table cell, or dock strip. */
  readonly className: string;
  /**
   * The API's own proxy path (`/products/:id/images/:index` or the variant's
   * `/products/variants/:id/images/:index`), not a shop url.
   */
  readonly imageUrl: string | null | undefined;
  /** Supplies the fallback letter. `null` renders an empty swatch. */
  readonly name: string | null | undefined;
  readonly testId?: string;
}

export function BenchThumb({ className, imageUrl, name, testId }: BenchThumbProps): ReactElement {
  const apiClient = useApiClient();
  // Memoised, or the hook's effect re-runs on every render and re-fetches.
  const fetchImage = useCallback((path: string) => apiClient.requestBlob(path), [apiClient]);
  return (
    <AuthenticatedImage
      className={className}
      imageUrl={imageUrl}
      name={name}
      fetchImage={fetchImage}
      testId={testId}
    />
  );
}
