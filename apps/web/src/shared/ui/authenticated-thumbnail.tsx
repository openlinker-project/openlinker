/**
 * Authenticated picture primitives
 *
 * An API-proxied image (`/products/:id/images/:i`, `/products/variants/:id/images/:i`)
 * sits behind the bearer token, which an `<img src>` cannot carry, so the bytes
 * are fetched with the caller-supplied fetcher and shown as an object url.
 * `shared` may not import `app`, hence the `fetchImage` prop; a feature wrapper
 * (`VariantThumbnail`) binds it to the api client.
 *
 * While loading, on failure and when there is no picture at all the same
 * placeholder (the name's initial) renders - never a broken-image icon.
 *
 * @module apps/web/src/shared/ui
 */
import type { ReactElement } from 'react';

import {
  useAuthenticatedImage,
  type AuthenticatedImageFetcher,
} from '../hooks/use-authenticated-image';

export interface AuthenticatedImageProps {
  readonly className: string;
  readonly imageUrl: string | null | undefined;
  /** Supplies the placeholder letter. */
  readonly name: string | null | undefined;
  readonly fetchImage: AuthenticatedImageFetcher;
  readonly testId?: string;
}

export function AuthenticatedImage({
  className,
  imageUrl,
  name,
  fetchImage,
  testId,
}: AuthenticatedImageProps): ReactElement {
  const image = useAuthenticatedImage(imageUrl, fetchImage);
  const initial = (name ?? '').trim().charAt(0).toUpperCase();

  if (image.status === 'ready') {
    return <img className={className} src={image.objectUrl} alt="" data-testid={testId} />;
  }

  return (
    <span className={`${className} ${className}--empty`} aria-hidden="true" data-testid={testId}>
      {initial}
    </span>
  );
}

export type AuthenticatedThumbnailSize = 'sm' | 'md' | 'lg';

export interface AuthenticatedThumbnailProps {
  readonly src: string | null | undefined;
  readonly name: string;
  readonly fetchImage: AuthenticatedImageFetcher;
  readonly size?: AuthenticatedThumbnailSize;
  /** Draws the picture dimmed, e.g. when it is inherited rather than the item's own. */
  readonly dimmed?: boolean;
  readonly className?: string;
  readonly testId?: string;
}

export function AuthenticatedThumbnail({
  src,
  name,
  fetchImage,
  size = 'md',
  dimmed = false,
  className = '',
  testId,
}: AuthenticatedThumbnailProps): ReactElement {
  const classes = [
    'product-thumbnail',
    `product-thumbnail--${size}`,
    dimmed ? 'product-thumbnail--dimmed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} aria-hidden="true" data-testid={testId}>
      <AuthenticatedImage
        className="product-thumbnail__image"
        imageUrl={src}
        name={name}
        fetchImage={fetchImage}
      />
    </span>
  );
}
