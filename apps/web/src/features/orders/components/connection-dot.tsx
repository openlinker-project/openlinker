/**
 * Connection Dot
 *
 * Mini connection badge (#1776) — a coloured disc + one initial letter + an
 * accessible full-name alternative. Used by the delivery chip, the list quiet
 * takeover marker context, and the order-detail "Shipped by" row to identify
 * which connection (carrier or destination shop) owns an order's fulfilment.
 *
 * Colour is decoration, never the sole signal: the initial glyph + a
 * visually-hidden full name + the `title` carry the real meaning. No platform
 * colour exists in the app, so the hue is a stable hash of the platform type
 * (or name) — a generic (name-less) dot ignores the hash and renders muted grey.
 *
 * @module apps/web/src/features/orders/components
 */
import type { CSSProperties, ReactElement } from 'react';

interface ConnectionDotProps {
  /** Full connection name (tooltip + a11y text). `null` → generic glyph. */
  name: string | null;
  /** Hue + initial source when `name` is null; carried through when known. */
  platformType?: string | null;
  /** Only affects the generic (name === null) glyph. */
  variant?: 'shop' | 'carrier';
}

/** Deterministic 0–359 hue from a seed so a connection always gets the same colour. */
function stableHue(seed: string): number {
  let h = 0;
  for (const c of seed) {
    h = (h * 31 + c.charCodeAt(0)) % 360;
  }
  return h;
}

function computeInitial(
  name: string | null,
  platformType: string | null | undefined,
  variant: 'shop' | 'carrier',
): string {
  if (name) {
    const alnum = name.match(/[a-z0-9]/i);
    return (alnum ? alnum[0] : name[0]).toUpperCase();
  }
  if (platformType) {
    return platformType[0].toUpperCase();
  }
  return variant === 'carrier' ? '?' : 'S';
}

function cx(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function ConnectionDot({
  name,
  platformType = null,
  variant = 'shop',
}: ConnectionDotProps): ReactElement {
  const isGeneric = name === null;
  const fullName = name ?? (variant === 'carrier' ? 'a carrier' : 'the destination shop');
  const initial = computeInitial(name, platformType, variant);
  // Generic dots ignore the hash (muted grey via the modifier class); named/known
  // dots carry a stable hue seeded on platformType (falling back to the name).
  const style: CSSProperties | undefined = isGeneric
    ? undefined
    : ({ '--conn-hue': stableHue(platformType ?? name ?? '') } as CSSProperties);

  return (
    <span className={cx('conn-dot', isGeneric && 'conn-dot--generic')} style={style} title={fullName}>
      {/* SVG text is geometrically centered (text-anchor + dominant-baseline),
          so the initial sits dead-centre regardless of the font's ascent/descent
          metrics - CSS line-box centering left it visibly off. */}
      <svg className="conn-dot__glyph" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <text x="7" y="7" textAnchor="middle" dominantBaseline="central">
          {initial}
        </text>
      </svg>
      <span className="sr-only">{fullName}</span>
    </span>
  );
}
