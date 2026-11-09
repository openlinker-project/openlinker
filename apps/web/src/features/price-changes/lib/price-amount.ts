/**
 * Price Amount helpers (#3148, #3873)
 *
 * Parsing and clamping for a manual price entry. No operator copy lives here.
 *
 * @module apps/web/src/features/price-changes/lib
 */
import { minorUnitExponentFor } from '../../invoicing';

/**
 * European-tolerant numeric parse for a manual price entry (#3148 review,
 * finding 7) — `Number(raw.replace(',', '.'))` only ever replaces the FIRST
 * comma, so a thousands-grouped value like `1 234,56` or `1.234,56` both
 * parse to `NaN` and surface the wrong "enter a price greater than 0" error
 * for an otherwise valid number on a PLN-denominated screen.
 *
 * Whitespace (a thousands separator, `1 234,56`) is stripped outright. When
 * both `,` and `.` appear, whichever occurs LAST is read as the decimal
 * separator and the other is treated as a thousands grouping mark. A lone
 * `.` or `,` appearing MORE than once (`1,234,567` / `1.234.567`) is
 * unambiguously a thousands grouping — a decimal separator occurs at most
 * once — and is stripped outright.
 *
 * **A lone separator occurring EXACTLY once, followed by EXACTLY 3 digits,
 * is genuinely ambiguous and is refused rather than guessed (#3148 second
 * review, still-open BLOCKING finding).** `"1,234"` reads identically
 * either as a thousands-grouped `1234` (the US/UK convention, and the exact
 * example the review names — an operator typing it expecting `1234` gets a
 * price ~1000× too low with nothing telling them) or as `1.234`, a
 * 3-decimal-place European reading. Treating it as decimal by default
 * — the previous fix's assumption, still visible in `isAmbiguousSeparator`'s
 * sibling reasoning below — silently reproduces the exact bug the review
 * called out. Refusing it is what `feedbackFor` surfaces as a distinct,
 * actionable error rather than a bare "enter a price greater than 0."
 */
function isAmbiguousSeparator(cleaned: string, separator: ',' | '.'): boolean {
  const occurrences = cleaned.split(separator).length - 1;
  if (occurrences !== 1) return false;
  const trailingDigits = cleaned.length - cleaned.indexOf(separator) - 1;
  return trailingDigits === 3;
}

export function parseLocalizedAmount(raw: string): number {
  const cleaned = raw.trim().replace(/\s/g, '');
  // `Number('')` is 0, not NaN, so an empty input would otherwise leave this
  // helper reporting a valid zero against its own documented NaN-for-invalid
  // contract (#3165 round-3 review). Today's only caller happens to catch it
  // with a `> 0` check; the next one through the barrel will not.
  if (cleaned === '') return NaN;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    const normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    return Number(normalized);
  }

  if (hasComma) {
    if (isAmbiguousSeparator(cleaned, ',')) return NaN;
    // A single `,` with anything OTHER than exactly 3 trailing digits is
    // unambiguous (`1,5`, `399,50`) and is read as the decimal separator;
    // more than one `,` (`1,234,567`) is unambiguous thousands grouping and
    // is stripped outright rather than replaced with `.` — the previous
    // shape replaced EVERY comma with `.`, turning `1,234,567` into the
    // syntactically invalid `1.234.567` and silently producing `NaN` for a
    // perfectly good number (found re-verifying #3167 against a fresh merge
    // of this branch's own #3165 fix).
    return Number(
      cleaned.split(',').length - 1 > 1 ? cleaned.replace(/,/g, '') : cleaned.replace(/,/g, '.')
    );
  }

  if (hasDot) {
    if (isAmbiguousSeparator(cleaned, '.')) return NaN;
    // A single `.` with anything OTHER than exactly 3 trailing digits is
    // unambiguous (`1.5`, `1.23`) and already a valid JS numeric literal;
    // more than one `.` (`1.234.567`) is unambiguous grouping and is
    // stripped.
    return Number(cleaned.split('.').length - 1 > 1 ? cleaned.replace(/\./g, '') : cleaned);
  }

  // `Number('')` is `0`, not `NaN` — an empty field must read as "no valid
  // amount" rather than a silently-accepted zero price (same re-verify
  // pass as the comma fix above).
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

/**
 * The DB column backing a manual price override is `numeric(14,4)`, but the
 * currency the price actually publishes in almost always carries FEWER
 * decimal places than that (2 for PLN/EUR, 0 for a zero-decimal currency) —
 * clamping only to the storage column's precision let an operator confirm
 * e.g. `399.999` on a 2-decimal currency and be surprised by the extra digit
 * reappearing wherever the amount is next formatted (#3148 second review,
 * still-open BLOCKING finding). Clamping to the CURRENCY's own minor-unit
 * exponent — the same table `minorUnitExponentFor` already applies to a
 * shipping-tax split — is what shows the operator the number that will
 * actually be published, not merely one that survives the database column.
 */
export function clampToStorablePrecision(value: number, currency?: string | null): number {
  const exponent = minorUnitExponentFor(currency);
  const factor = 10 ** exponent;
  return Math.round(value * factor) / factor;
}

