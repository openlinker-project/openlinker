/**
 * Bulk image lightbox (#1741)
 *
 * Medium-style click-to-zoom overlay: dark backdrop, the image scaled up and
 * centered (up to 90vh), fade + scale in, closing on backdrop click, the X, or
 * Escape. Reduced-motion is respected.
 *
 * Built on Radix Dialog (the project overlay primitive) so it gets a real focus
 * trap + focus restore and per-layer Escape handling for free (#1741 review #8):
 * when opened from inside the bulk Edit modal (itself a Radix Dialog), Escape
 * dismisses only the lightbox — Radix's dismissable-layer stack stops the event
 * before it reaches the edit modal's own discard-guard. Radix also locks body
 * scroll while open, so no manual `overflow` toggle is needed. The content sits
 * at a z-index above the modal tier, so it renders above the edit modal.
 *
 * Shared by the bulk Review step (product thumbnail) and the bulk Edit modal
 * (offer/variant image strips).
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { ReactElement } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '../../../../shared/ui/dialog';

export function BulkImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Reuses the shared `.lightbox-dialog-*` modifiers that strip the default
          dialog card chrome. Clicking the dark overlay (a portal sibling) closes
          via Radix's dismissable layer; the image inside the content does not. */}
      <DialogContent
        className="lightbox-dialog-content"
        overlayClassName="lightbox-dialog-overlay"
        aria-label={`${name} image`}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{name} image</DialogTitle>
        <img className="bulk-image-lightbox__img" src={src} alt={name} />
        <DialogClose asChild>
          <button type="button" className="bulk-image-lightbox__close" aria-label="Close image">
            &#10005;
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
