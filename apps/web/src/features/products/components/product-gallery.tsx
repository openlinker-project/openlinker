import { useCallback, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../../../shared/ui/dialog';

interface ProductGalleryProps {
  images: string[];
  name: string;
}

export function ProductGallery({ images, name }: ProductGalleryProps): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setLightboxOpen] = useState(false);

  const navigate = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => (prev + delta + images.length) % images.length);
    },
    [images.length],
  );

  if (images.length === 0) {
    return <ProductThumbnail src={null} name={name} size="md" />;
  }

  const activeImage = images[activeIndex];

  return (
    <div className="product-gallery" role="group" aria-label="Product photos">
      {/* Dialog gives the lightbox focus trap, initial focus, focus
          restoration to the trigger button, background scroll-lock, and a
          portal — for free, matching the a11y bar every other modal in this
          app meets (shared/ui/dialog.tsx wraps Radix Dialog). The trigger
          button is a real DialogTrigger (not a manual onClick) so Radix can
          track it and return focus to it on close. */}
      <Dialog open={isLightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogTrigger asChild>
          <button type="button" className="product-gallery__main" aria-label="Open photo viewer">
            <img src={activeImage} alt="" />
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
                aria-label={`Photo ${index + 1} of ${images.length}`}
              >
                <img src={image} alt="" loading="lazy" />
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
          <DialogTitle className="sr-only">{name} photo viewer</DialogTitle>
          <DialogDescription className="sr-only">
            Use the arrow keys or the on-screen controls to browse photos. Press Escape to close.
          </DialogDescription>
          <div className="lightbox">
            <button
              type="button"
              className="lightbox__close"
              aria-label="Close"
              onClick={() => setLightboxOpen(false)}
            >
              ✕
            </button>
            <div className="lightbox__frame">
              <img src={activeImage} alt={`${name} — photo ${activeIndex + 1} of ${images.length}`} />
              {images.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--prev"
                    aria-label="Previous photo"
                    onClick={() => navigate(-1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className="lightbox__nav lightbox__nav--next"
                    aria-label="Next photo"
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
