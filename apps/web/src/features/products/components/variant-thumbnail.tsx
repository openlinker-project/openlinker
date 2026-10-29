/**
 * A variant's picture (#3587)
 *
 * Binds the shared authenticated thumbnail to the api client, so any surface
 * can show the API's variant image proxy path (`imageUrls[0]`).
 *
 * @module apps/web/src/features/products/components
 */
import { useCallback, type ReactElement } from 'react';

import { useApiClient } from '../../../app/api/api-client-provider';
import {
  AuthenticatedThumbnail,
  type AuthenticatedThumbnailSize,
} from '../../../shared/ui/authenticated-thumbnail';

export interface VariantThumbnailProps {
  readonly src: string | null | undefined;
  readonly name: string;
  readonly size?: AuthenticatedThumbnailSize;
  readonly dimmed?: boolean;
  readonly testId?: string;
}

export function VariantThumbnail({
  src,
  name,
  size = 'sm',
  dimmed,
  testId,
}: VariantThumbnailProps): ReactElement {
  const apiClient = useApiClient();
  const fetchImage = useCallback((path: string) => apiClient.requestBlob(path), [apiClient]);
  return (
    <AuthenticatedThumbnail
      src={src}
      name={name}
      size={size}
      dimmed={dimmed}
      fetchImage={fetchImage}
      testId={testId}
    />
  );
}
