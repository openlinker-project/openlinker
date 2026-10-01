/**
 * Shoper Tax Rate Mapper
 *
 * Maps a Shoper `/taxes` row onto ADR-063's rate code vocabulary
 * (`'23'`, `'8'`, `'5'`, `'0'`, `'zw'`, `'np'`).
 *
 * The code is read from the row NAME, never from `value` alone: on a live shop
 * three rows carry `value: "0"` - `0%`, `zw.` (exempt) and `np.` (not
 * applicable) - and collapsing an exemption onto a plain `0` is a different
 * fiscal statement.
 *
 * The NAME is also not trusted on its own. It is a free label a merchant can
 * edit, and the result feeds a fiscal document, so the row's `value` must
 * agree with it:
 *   - a name that parses to a percentage must equal `Number(value)` (a tax
 *     named "23%" with value 8 is a hand-edited or corrupted row);
 *   - an exemption name (`zw`, `np`) must carry value 0.
 * A disagreement is reported as unreadable by the caller - ADR-063 says never
 * to guess a rate, and two fields that contradict each other are a guess.
 *
 * `oo` is deliberately absent: no live row has ever carried it (the trial
 * shop's table is `23%`, `8%`, `0%`, `zw.`, `np.`, `5%`), and an unrecognised
 * name is already reported as unreadable, which is the safe default. It can be
 * added the day a real row shows Shoper's spelling.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { ShoperTax } from '../../domain/types/shoper-api.types';

const EXEMPTION_CODES: Readonly<Record<string, string>> = {
  zw: 'zw',
  np: 'np',
};

/** `23%`, `23`, `23 %`, `23,0%`, `23.00` - a whole percentage only. */
const PERCENT = /^(\d{1,2})(?:[.,]0+)?\s*%?$/;

export type ShoperTaxRateResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly reason: 'unrecognised-name' | 'value-mismatch'; readonly detail: string };

/** The rate code a row NAME spells, or null when it spells none we know. */
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

/** The rate code of a whole `/taxes` row: the name, cross-checked against `value`. */
export function mapShoperTaxRow(row: Pick<ShoperTax, 'name' | 'value'>): ShoperTaxRateResult {
  const code = mapShoperTaxName(row.name);
  if (code === null) {
    return {
      ok: false,
      reason: 'unrecognised-name',
      detail: `Shoper tax "${row.name}" is not a recognised rate`,
    };
  }

  const value = typeof row.value === 'string' || typeof row.value === 'number' ? Number(row.value) : Number.NaN;
  const expected = code in EXEMPTION_CODES ? 0 : Number(code);
  if (!Number.isFinite(value) || value !== expected) {
    return {
      ok: false,
      reason: 'value-mismatch',
      detail: `Shoper tax "${row.name}" carries value ${String(row.value)}, which contradicts its name`,
    };
  }

  return { ok: true, code };
}
