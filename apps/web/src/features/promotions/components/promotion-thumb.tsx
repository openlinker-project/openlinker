/**
 * PromotionThumb (#3935)
 *
 * The small tile that stands for a product in the promotions pages: its picture
 * when it has one, a gift mark when it does not. The tile is tinted by a stable
 * hue taken from the product, so two different gifts side by side do not look
 * the same.
 *
 * @module apps/web/src/features/promotions/components
 */
import type { ReactElement } from 'react';
import { VariantThumbnail } from '../../products';

const HUES = ['a', 'b', 'c', 'd'] as const;

function hueOf(seed: string): (typeof HUES)[number] {
  let sum = 0;
  for (const char of seed) sum += char.charCodeAt(0);
  return HUES[sum % HUES.length];
}

export function GiftGlyph(): ReactElement {
  return (
    <svg className="pm-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 11h16v9H4z" />
      <path d="M3 7.5h18V11H3z" />
      <path d="M12 7.5V20" />
      <path d="M12 7.5c-2 0-4-1-4-3 2 0 4 1 4 3zm0 0c2 0 4-1 4-3-2 0-4 1-4 3z" />
    </svg>
  );
}

export interface PromotionThumbProps {
  /** Seeds the tint. */
  seed: string;
  name: string;
  imageSrc?: string | null;
  size?: 'md' | 'lg';
  className?: string;
}

export function PromotionThumb({
  seed,
  name,
  imageSrc = null,
  size = 'md',
  className,
}: PromotionThumbProps): ReactElement {
  return (
    <span
      className={['pm-thumb', `pm-thumb--${hueOf(seed)}`, size === 'lg' ? 'pm-thumb--lg' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {imageSrc ? <VariantThumbnail src={imageSrc} name={name} size="sm" /> : <GiftGlyph />}
    </span>
  );
}
