import { useCallback, useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ProductThumbnail } from '../../../shared/ui/product-thumbnail';

interface ProductGalleryProps {
  images: string[];
  name: string;
}

export function ProductGallery({ images, name }: ProductGalleryProps): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLightboxOpen, setLightboxOpen] = useState(false);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const navigate = useCallback(
    (delta: number) => {
      setActiveIndex((prev) => (prev + delta + images.length) % images.length);
    },
    [images.length],
  );

  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowLeft') navigate(-1);
      if (event.key === 'ArrowRight') navigate(1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, closeLightbox, navigate]);

  if (images.length === 0) {
    return <ProductThumbnail src={null} name={name} size="md" />;
  }

  const activeImage = images[activeIndex];

  return (
    <div className="product-gallery" role="group" aria-label="Product photos">
      <button
        type="button"
        className="product-gallery__main"
        onClick={() => setLightboxOpen(true)}
        aria-label="Open photo viewer"
      >
        <img src={activeImage} alt="" />
        <span className="product-gallery__expand-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
          </svg>
        </span>
      </button>
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
              <img src={image} alt="" />
            </button>
          ))}
        </div>
      ) : null}

      {isLightboxOpen ? (
        <div
          className="lightbox-overlay is-open"
          role="dialog"
          aria-modal="true"
          aria-label={`${name} photo viewer`}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeLightbox();
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') closeLightbox();
          }}
        >
          <div className="lightbox">
            <button
              type="button"
              className="lightbox__close"
              aria-label="Close"
              onClick={closeLightbox}
            >
              ✕
            </button>
            <div className="lightbox__frame">
              <img src={activeImage} alt="" />
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
        </div>
      ) : null}
    </div>
  );
}
