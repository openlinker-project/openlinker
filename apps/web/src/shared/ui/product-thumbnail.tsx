import { forwardRef, useState, type ComponentPropsWithoutRef, type ReactElement } from 'react';

export type ProductThumbnailSize = 'md' | 'sm';

export interface ProductThumbnailProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  alt?: string;
  name: string;
  size?: ProductThumbnailSize;
  src: string | null | undefined;
}

export const ProductThumbnail = forwardRef<HTMLSpanElement, ProductThumbnailProps>(
  function ProductThumbnail(
    { alt = '', className = '', name, size = 'md', src, ...rest }: ProductThumbnailProps,
    ref,
  ): ReactElement {
    const [erroredSrc, setErroredSrc] = useState<string | null>(null);

    const classes = ['product-thumbnail', `product-thumbnail--${size}`, className]
      .filter(Boolean)
      .join(' ');
    const showImage = Boolean(src) && erroredSrc !== src;
    const initial = name.trim().charAt(0).toUpperCase();

    return (
      <span
        ref={ref}
        className={classes}
        {...rest}
        aria-hidden={alt === '' ? true : undefined}
      >
        {showImage ? (
          <img
            src={src ?? undefined}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => {
              setErroredSrc(src ?? null);
            }}
          />
        ) : (
          <>
            <span aria-hidden="true">{initial}</span>
            {alt === '' ? null : <span className="sr-only">{alt}</span>}
          </>
        )}
      </span>
    );
  },
);
