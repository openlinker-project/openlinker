/**
 * Bulk Image Strip
 *
 * The editable image strip shared by the bulk offer editor's three image
 * fields (the shared base or simple offer, a single variant, and the shop
 * publish base). It owns the add flow and the broken-thumbnail state so the
 * three fields cannot drift apart on what they accept.
 *
 * Two checks, deliberately of different strength:
 * - At add time an address that is not an absolute http(s) URL, or that is
 *   already listed, is REFUSED. Nothing about it can be right, and the
 *   marketplace would only reject it after the batch is submitted.
 * - A thumbnail that fails to load is only WARNED about. The browser's load
 *   failure is the signal for a missing file or a non-image, but CORS, a slow
 *   CDN or being offline fail the same way for a perfectly good image, so it
 *   never blocks saving.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import { useId, useState, type ReactElement } from 'react';
import { Button, FieldError, Input } from '../../../../shared/ui';
import { checkImageUrl, type ImageUrlProblem } from '../../lib/image-url';

export const IMAGE_URL_PROBLEM_COPY: Record<ImageUrlProblem, string> = {
  empty: 'Enter an image address, starting with https://.',
  'not-a-url':
    'This is not a web address. Enter a full image address starting with https:// or http://, for example https://example.com/photo.jpg.',
  duplicate: 'This image is already in the list. Enter a different address.',
};

export const BROKEN_IMAGE_BADGE = 'Not loading';

export function brokenImagesNote(count: number): string {
  const subject = count === 1 ? '1 image could not be loaded' : `${count} images could not be loaded`;
  return `${subject}. The address may be wrong or may not point to an image. Remove it or use another address.`;
}

/**
 * Zoomable thumbnail body. A `role="button"` span rather than a `<button>` so
 * it stays clickable inside the demo read-only `fieldset` disabled cascade -
 * zooming is always allowed, only edit actions are gated. `stopPropagation`
 * keeps the click from toggling the surrounding controls.
 */
function ThumbZoomButton({
  url,
  onZoom,
  onLoadResult,
}: {
  url: string;
  onZoom: (src: string) => void;
  onLoadResult: (url: string, loaded: boolean) => void;
}): ReactElement {
  return (
    <span
      role="button"
      tabIndex={0}
      className="bulk-editor__thumb-btn"
      aria-label="Zoom image"
      onClick={(e) => {
        e.stopPropagation();
        onZoom(url);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onZoom(url);
        }
      }}
    >
      <img
        src={url}
        alt=""
        onLoad={() => onLoadResult(url, true)}
        onError={() => onLoadResult(url, false)}
      />
    </span>
  );
}

interface BulkImageStripProps {
  images: readonly string[];
  onImagesChange: (next: string[]) => void;
  onZoom: (src: string) => void;
  /** Dims the thumbnails - the list is inherited, not this scope's own. */
  inherited?: boolean;
  /** Marks the strip as the `images` focus target for blocker deep links. */
  focusTarget?: boolean;
}

export function BulkImageStrip({
  images,
  onImagesChange,
  onZoom,
  inherited = false,
  focusTarget = false,
}: BulkImageStripProps): ReactElement {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<ImageUrlProblem | null>(null);
  // Keyed by URL, not index: removing a tile shifts every later index, and a
  // flag attached to an index would jump onto the neighbour.
  const [brokenUrls, setBrokenUrls] = useState<ReadonlySet<string>>(() => new Set());
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const brokenCount = images.filter((url) => brokenUrls.has(url)).length;

  const onLoadResult = (url: string, loaded: boolean): void => {
    setBrokenUrls((prev) => {
      if (prev.has(url) === !loaded) return prev;
      const next = new Set(prev);
      if (loaded) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const closeAdd = (): void => {
    setDraft('');
    setProblem(null);
    setAdding(false);
  };

  const submitDraft = (): void => {
    const result = checkImageUrl(draft, images);
    if (!result.ok) {
      // The input stays open with what was typed, so the operator corrects it
      // instead of retyping it.
      setProblem(result.problem);
      return;
    }
    onImagesChange([...images, result.url]);
    closeAdd();
  };

  return (
    <>
      <div
        className="bulk-editor__img-strip bulk-editor__img-strip--editable"
        {...(focusTarget ? { 'data-focus-field': 'images' } : {})}
      >
        {images.map((url, i) => {
          const broken = brokenUrls.has(url);
          return (
            <span
              key={`${url}-${i}`}
              className={[
                'bulk-editor__img-thumb',
                inherited ? 'bulk-editor__img-thumb--ghost' : '',
                broken ? 'bulk-editor__img-thumb--broken' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={broken ? `${BROKEN_IMAGE_BADGE}: ${url}` : undefined}
            >
              <ThumbZoomButton url={url} onZoom={onZoom} onLoadResult={onLoadResult} />
              {broken ? <span className="bulk-editor__img-broken">{BROKEN_IMAGE_BADGE}</span> : null}
              <button
                type="button"
                className="bulk-editor__img-x"
                aria-label="Remove image"
                onClick={() => onImagesChange(images.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </span>
          );
        })}
        {!adding ? (
          <button
            type="button"
            className="bulk-editor__img-add"
            aria-label="Add image"
            onClick={() => setAdding(true)}
          >
            ＋
          </button>
        ) : null}
      </div>
      {/* Always mounted: a live region that appears together with its text is
          often not announced. */}
      <p className="bulk-editor__img-note" aria-live="polite">
        {brokenCount > 0 ? brokenImagesNote(brokenCount) : null}
      </p>
      {adding ? (
        <>
          <div className="bulk-editor__img-add-row">
            <Input
              id={inputId}
              className="bulk-editor__input"
              value={draft}
              invalid={problem !== null}
              aria-invalid={problem !== null}
              aria-describedby={problem !== null ? errorId : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                if (problem !== null) setProblem(null);
              }}
              onKeyDown={(e) => {
                // Enter adds the image; without preventDefault it would submit
                // the surrounding editor form instead.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitDraft();
                }
              }}
              placeholder="https://example.com/image.jpg"
              aria-label="New image URL"
            />
            <Button tone="primary" type="button" className="button--sm" onClick={submitDraft}>
              Add
            </Button>
            <Button tone="ghost" type="button" className="button--sm" onClick={closeAdd}>
              Cancel
            </Button>
          </div>
          <FieldError id={errorId} message={problem !== null ? IMAGE_URL_PROBLEM_COPY[problem] : undefined} />
        </>
      ) : null}
    </>
  );
}
