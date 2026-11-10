import {
  useCallback,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useAuthenticatedImage } from '../../../shared/hooks/use-authenticated-image';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../shared/ui/dialog';
import { interpolate, useMessages } from '../../../shared/i18n';

interface ProductGalleryProps {
  images: string[];
  name: string;
  /**
   * When given, each picture is read through the API's image proxy
   * (`/products/:id/images/:index`) instead of the stored url. The stored url
   * is the one the catalogue sync used, which on a self-hosted install is
   * often an internal host the browser cannot resolve.
   */
  productId?: string;
}

interface GalleryImgProps extends Omit<ComponentPropsWithoutRef<'img'>, 'src'> {
  src: string;
  productId?: string;
  index: number;
}

/** One gallery picture: proxied with the session's token when a product id is known. */
function GalleryImg({ src, productId, index, onError, ...props }: GalleryImgProps): ReactElement {
  const apiClient = useApiClient();
  const fetchImage = useCallback((path: string) => apiClient.requestBlob(path), [apiClient]);
  const proxied = useAuthenticatedImage(
    productId ? `/products/${encodeURIComponent(productId)}/images/${String(index)}` : null,
    fetchImage,
  );
  if (proxied.status === 'ready') {
    // The proxied bytes loaded, so a broken mark the stored url earned does not apply.
    const { className, ...rest } = props;
    const kept = className?.split(' ').filter((c) => c !== 'is-broken').join(' ') || undefined;
    return <img src={proxied.objectUrl} className={kept} {...rest} />;
  }
  // No product id, or the proxy has nothing (yet): the stored url, hidden by
  // the caller's `onError` when the browser cannot load it either.
  return <img src={src} onError={onError} {...props} />;
}

export function ProductGallery({ images, name, productId }: ProductGalleryProps): ReactElement {
  const copy = useMessages('products').productGallery;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setLightboxOpen] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const navigate = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => (prev + delta + images.length) % images.length);
    },
    [images.length],
  );

  const initial = name.trim().charAt(0).toUpperCase() || '?';

  // No photos: render the same bordered square the gallery uses, with a
  // neutral initial placeholder — never a clipped/broken-image box. No
  // `role="group"` here: its only child is decorative (`aria-hidden`), so a
  // labelled group would announce as empty to screen readers.
  if (images.length === 0) {
    return (
      <div className="product-gallery">
        <div className="product-gallery__main product-gallery__main--static" aria-hidden="true">
          <span className="product-gallery__placeholder">{initial}</span>
        </div>
      </div>
    );
  }

  const activeImage = images[activeIndex];
  const isActiveBroken = Boolean(brokenImages[activeImage]);

  return (
    <div className="product-gallery" role="group" aria-label={copy.groupLabel}>
      {/* Dialog gives the lightbox focus trap, initial focus, focus
          restoration to the trigger button, background scroll-lock, and a
          portal — for free, matching the a11y bar every other modal in this
          app meets (shared/ui/dialog.tsx wraps Radix Dialog). The trigger
          button is a real DialogTrigger (not a manual onClick) so Radix can
          track it and return focus to it on close. */}
      <Dialog open={isLightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogTrigger asChild>
          <button type="button" className="product-gallery__main" aria-label={copy.openViewer}>
            <span className="product-gallery__placeholder" aria-hidden="true">
              {initial}
            </span>
            <GalleryImg
              src={activeImage}
              productId={productId}
              index={activeIndex}
              alt={name}
              className={isActiveBroken ? 'is-broken' : undefined}
              onError={() => setBrokenImages((prev) => ({ ...prev, [activeImage]: true }))}
            />
            <span className="product-gallery__expand-hint" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
              </svg>
            </span>
          </button>
        </DialogTrigger>
        {images.length > 1 ? (
          <div className="product-gallery__thumbs">
            {images.map((image, index) => (
              <button
                key={image}
                type="button"
                className={`product-gallery__thumb${index === activeIndex ? ' is-active' : ''}`}
                onClick={() => setActiveIndex(index)}
                aria-label={interpolate(copy.thumbLabel, {
                  index: index + 1,
                  total: images.length,
                })}
              >
                <GalleryImg
                  src={image}
                  productId={productId}
                  index={index}
                  alt=""
                  loading="lazy"
                  className={brokenImages[image] ? 'is-broken' : undefined}
                  onError={() => setBrokenImages((prev) => ({ ...prev, [image]: true }))}
                />
              </button>
            ))}
          </div>
        ) : null}

        <DialogContent
          className="lightbox-dialog-content"
          overlayClassName="lightbox-dialog-overlay"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'ArrowLeft') navigate(-1);
            if (event.key === 'ArrowRight') navigate(1);
          }}
        >
          <DialogTitle className="sr-only">
            {interpolate(copy.viewerTitle, { name })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {copy.viewerDescriptionBrowse} {copy.viewerDescriptionClose}
          </DialogDescription>
          <div className="lightbox">
            <button
              type="button"
              className="lightbox__close"
              aria-label={copy.close}
              onClick={() => setLightboxOpen(false)}
            >
              ✕
            </button>
            <div className="lightbox__frame">
              <GalleryImg src={activeImage} productId={productId} index={activeIndex} alt={interpolate(copy.lightboxAlt, {
                  name,
                  index: activeIndex + 1,
                  total: images.length,
                })} />
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--prev"
                    aria-label={copy.previous}
                    onClick={() => navigate(-1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--next"
                    aria-label={copy.next}
                    onClick={() => navigate(1)}
                  >
                    ›
                  </button>
                </>
              ) : null}
            </div>
            <p className="lightbox__caption">
              {activeIndex + 1} / {images.length}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
