/**
 * Bulk image lightbox (#1741)
 *
 * Medium-style click-to-zoom overlay: dark backdrop, the image scaled up and
 * centered (up to 90vh), fade + scale in, closing on backdrop click, the X, or
 * Escape. Body scroll is locked while open and reduced-motion is respected.
 *
 * Shared by the bulk Review step (product thumbnail) and the bulk Edit modal
 * (offer/variant image strips). It is a plain fixed overlay with a z-index above
 * the modal tier, so it renders above the edit modal when opened from there.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useEffect, type ReactElement } from 'react';

export function BulkImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="bulk-image-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${name} image`}
      onClick={onClose}
    >
      <img
        className="bulk-image-lightbox__img"
        src={src}
        alt={name}
        onClick={(e) => {
          e.stopPropagation();
        }}
      />
      <button
        type="button"
        className="bulk-image-lightbox__close"
        aria-label="Close image"
        onClick={onClose}
      >
        &#10005;
      </button>
    </div>
  );
}
