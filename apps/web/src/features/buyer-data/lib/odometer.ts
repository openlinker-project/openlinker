/**
 * Odometer (#4289)
 *
 * The pure half of the rolling figure: a formatted number cut into columns,
 * digits as reels that slide to their value and everything else (separators,
 * signs) as fixed characters. Columns are keyed from the RIGHT so the units
 * column stays the same element when the number grows a digit, which is what
 * lets it roll instead of re-mounting.
 *
 * @module apps/web/src/features/buyer-data/lib
 */

export interface OdometerColumn {
  /** Stable across renders: position counted from the right. */
  key: string;
  /** 0-9 for a digit reel, null for a fixed character. */
  digit: number | null;
  char: string;
}

export function splitOdometer(text: string): OdometerColumn[] {
  const chars = Array.from(text);
  return chars.map((char, index) => ({
    key: `c${chars.length - index}`,
    digit: /^[0-9]$/.test(char) ? Number(char) : null,
    char,
  }));
}

/** "+120" / "-37"; null when nothing changed. */
export function formatDelta(
  from: number,
  to: number,
  format: (n: number) => string
): string | null {
  const delta = to - from;
  if (delta === 0) return null;
  return `${delta > 0 ? '+' : '-'}${format(Math.abs(delta))}`;
}
