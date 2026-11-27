/**
 * QrCode
 *
 * Renders a QR code as inline, self-contained SVG - no <img>, no network, no
 * canvas. Uses `qrcode-generator` (a mature, zero-runtime-dependency, MIT
 * headless QR-*logic* library) purely to compute the module matrix; the SVG
 * markup (a single `<path>` of the dark modules over a light background) is
 * built here so the visual stays under our control and design system.
 *
 * QR codes must stay dark-on-light to remain scannable, so the colours are
 * FIXED (dark modules on a white background) and intentionally do NOT follow
 * the light/dark theme - a phone camera has to read this off a screen or a
 * printed page. A quiet zone (margin) of 4 modules is included per the QR spec.
 *
 * @module shared/ui
 */
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import qrcode from 'qrcode-generator';

export type QrCodeErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

interface QrCodeProps {
  /** The string to encode (for KSeF: the verification URL). */
  value: string;
  /** Rendered size in px (width = height). Defaults to 160. */
  size?: number;
  /**
   * Error-correction level. `M` (~15% recovery) is the sensible default for a
   * clean on-screen / PDF verification code.
   */
  errorCorrectionLevel?: QrCodeErrorCorrectionLevel;
  /** Accessible label; when absent the SVG is treated as decorative. */
  ariaLabel?: string;
  className?: string;
}

/** Quiet-zone width in modules, per the QR Code specification. */
const QUIET_ZONE_MODULES = 4;

export function QrCode({
  value,
  size = 160,
  errorCorrectionLevel = 'M',
  ariaLabel,
  className = '',
}: QrCodeProps): ReactElement | null {
  const model = useMemo(() => {
    if (value.length === 0) return null;
    // typeNumber 0 = auto-select the smallest version that fits `value`.
    const qr = qrcode(0, errorCorrectionLevel);
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const total = count + QUIET_ZONE_MODULES * 2;
    // One path command per dark module, offset by the quiet zone.
    const segments: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) {
          segments.push(`M${col + QUIET_ZONE_MODULES} ${row + QUIET_ZONE_MODULES}h1v1h-1z`);
        }
      }
    }
    return { total, path: segments.join('') };
  }, [value, errorCorrectionLevel]);

  if (!model) return null;

  const classes = ['qr-code', className].filter(Boolean).join(' ');

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox={`0 0 ${model.total} ${model.total}`}
      shapeRendering="crispEdges"
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
    >
      <rect width={model.total} height={model.total} fill="#ffffff" />
      <path d={model.path} fill="#000000" />
    </svg>
  );
}
