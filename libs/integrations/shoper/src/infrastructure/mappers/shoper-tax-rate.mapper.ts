/**
 * Shoper Tax Rate Mapper
 *
 * Maps a Shoper `/taxes` row NAME onto ADR-063's rate code vocabulary
 * (`'23'`, `'8'`, `'5'`, `'0'`, `'zw'`, `'np'`, `'oo'`).
 *
 * Keyed on `name`, never on `value`: on a live shop three rows carry
 * `value: "0"` - `0%`, `zw.` (exempt) and `np.` (not applicable) - and
 * collapsing an exemption onto a plain `0` is a different fiscal statement,
 * one that `0` being an ANSWER in this model would let through silently.
 *
 * A name this function does not recognise returns `null`: the caller reports
 * it as unreadable rather than guessing a rate.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */

const EXEMPTION_CODES: Readonly<Record<string, string>> = {
  zw: 'zw',
  np: 'np',
  oo: 'oo',
};

/** `23%`, `23`, `23 %`, `23,0%`, `23.00` - a whole percentage only. */
const PERCENT = /^(\d{1,2})(?:[.,]0+)?\s*%?$/;

export function mapShoperTaxName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  const normalized = name.trim().toLowerCase().replace(/\.$/, '').trim();
  if (normalized.length === 0) {
    return null;
  }

  const exemption = EXEMPTION_CODES[normalized];
  if (exemption !== undefined) {
    return exemption;
  }

  const match = PERCENT.exec(normalized);
  return match === null ? null : String(Number(match[1]));
}
