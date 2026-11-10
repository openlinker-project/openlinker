/**
 * Gift lines - frontend mirror (#3941)
 *
 * Hand-maintained copy of the pure presenter in
 * `libs/core/src/sales-documents/domain/types/gift-lines.types.ts`. The browser
 * bundle does not depend on `@openlinker/core` (#591), so the settings preview
 * renders a sample receipt with THIS copy: a preview computed by different
 * arithmetic than the document is worse than none. `scripts/check-gift-lines-mirror.mjs`
 * (under `pnpm check:invariants`) fails the build when a mirrored declaration
 * drifts. Edit core first, then paste here. Comments and formatting are free;
 * the code is not.
 *
 * The connection-config reader and the write-side validator are deliberately
 * NOT mirrored: the server is the authority for both.
 */
import { minorUnitExponentFor } from '../../invoicing';

/** The four forms an operator picks (gifts spec section 8.2). */
export const GiftDocumentFormChoiceValues = [
  'technical-cent',
  'custom-price',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type GiftDocumentFormChoice = (typeof GiftDocumentFormChoiceValues)[number];

/**
 * The forms the one-line pickers offer (per gift, per bundle slot). `custom-price`
 * needs an amount input, which only the settings cards have, so it is not here;
 * the labels still name it so a saved value reads correctly. Not part of the
 * mirrored core vocabulary.
 */
export const GiftFormPickerValues: readonly GiftDocumentFormChoice[] =
  GiftDocumentFormChoiceValues.filter((form) => form !== 'custom-price');

/** The four choices plus the off-document record, which the UI does not offer. */
export const GiftLineFormValues = [...GiftDocumentFormChoiceValues, 'internal-record'] as const;
export type GiftLineForm = (typeof GiftLineFormValues)[number];

/** The OpenLinker-wide default when nothing is saved. */
export const DEFAULT_GIFT_LINE_FORM: GiftLineForm = 'technical-cent';

export function isGiftLineForm(value: unknown): value is GiftLineForm {
  return typeof value === 'string' && (GiftLineFormValues as readonly string[]).includes(value);
}

/** Where a gift's resolved form came from. */
export const GiftFormSourceValues = ['rule', 'connection', 'default'] as const;
export type GiftFormSource = (typeof GiftFormSourceValues)[number];

/**
 * A `custom-price` gift carries the gross unit price it shows at, a decimal
 * string in the order's currency, per gift unit: positive, at most two decimals.
 */
export function isGiftUnitPriceAmount(value: unknown): value is string {
  return typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

/** Parses an operator-typed amount ("2,50" or "2.50"); `null` when it is not a usable one. */
export function parseGiftUnitPrice(text: string): number | null {
  const normalised = text.trim().replace(',', '.');
  return isGiftUnitPriceAmount(normalised) ? Number(normalised) : null;
}

export interface ResolvedGiftForm {
  form: GiftLineForm;
  source: GiftFormSource;
  /** Set only for `custom-price`: the amount that came with the winning level. */
  unitPrice?: string;
}

/** The amount each level carries for `custom-price`; ignored for any other form. */
export interface GiftFormAmounts {
  line?: unknown;
  connection?: unknown;
  global?: unknown;
}

/**
 * Most specific wins: the gift's own form, then the connection's override, then
 * the OpenLinker-wide default. An unrecognised value at a level reads as absent.
 */
export function resolveGiftDocumentForm(
  lineForm: unknown,
  connectionForm: unknown,
  globalForm: unknown,
  amounts: GiftFormAmounts = {},
): ResolvedGiftForm {
  // A level naming `custom-price` without a usable amount reads as absent: the
  // amount comes with its level, never from a less specific one.
  const usable = (form: unknown, amount: unknown): form is GiftLineForm =>
    isGiftLineForm(form) && (form !== 'custom-price' || isGiftUnitPriceAmount(amount));
  const withAmount = (
    form: GiftLineForm,
    source: GiftFormSource,
    amount: unknown,
  ): ResolvedGiftForm =>
    form === 'custom-price' && isGiftUnitPriceAmount(amount)
      ? { form, source, unitPrice: amount }
      : { form, source };
  if (usable(lineForm, amounts.line)) return withAmount(lineForm, 'rule', amounts.line);
  if (usable(connectionForm, amounts.connection)) {
    return withAmount(connectionForm, 'connection', amounts.connection);
  }
  return usable(globalForm, amounts.global)
    ? withAmount(globalForm, 'default', amounts.global)
    : { form: DEFAULT_GIFT_LINE_FORM, source: 'default' };
}

/** The slice of a document line the helper reads and rewrites. */
export interface GiftPresentationLine {
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
  /** Set by the caller from the order line's `gift` marker. */
  isGift?: boolean;
  /**
   * The form resolved for THIS gift by the caller (`resolveGiftDocumentForm`).
   * Different gifts on one order may differ; absent uses the `form` argument.
   */
  giftForm?: GiftLineForm;
  /**
   * The gross unit price a `custom-price` gift shows at, per gift unit, resolved
   * by the caller alongside `giftForm`. Absent or non-positive: the form cannot
   * be applied and is noted `custom-price-invalid`.
   */
  giftUnitPriceGross?: number;
  /**
   * What one unit would cost on its own, gross. Only `priced-in` reads it, as
   * the weight the payment is shared by; without it a gift carries no value to
   * price in and falls back to `omit`.
   */
  referenceUnitPriceGross?: number;
}

export type GiftPresentationNote =
  | 'show-not-offered'
  | 'no-reference-price'
  | 'technical-cent-no-donor'
  | 'custom-price-no-donor'
  | 'custom-price-invalid'
  | 'zero-line-unfloorable';

export interface GiftPresentationResult<T extends GiftPresentationLine> {
  /** The lines the document carries, in the original order. */
  lines: T[];
  /** Gift lines kept off the document for the `internal-record` form. */
  internalRecordLines: T[];
  /** The form actually applied to at least one gift, after fallbacks. */
  appliedForm: GiftLineForm;
  /** Fallbacks taken, so a surface can say why the form differs from the setting. */
  notes: GiftPresentationNote[];
}

interface Entry<T extends GiftPresentationLine> {
  source: T;
  gift: boolean;
  /** Current lines for this entry (a paid line may be split in two). */
  lines: T[];
}

function rateKey(rate: string): string {
  const trimmed = rate.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? String(Number(trimmed)) : trimmed.toLowerCase();
}

/**
 * Present the gift lines of an order, each in its own resolved form.
 *
 * Only a line marked `isGift` AND priced 0 is a gift: a marked line the source
 * priced above zero carries real money and stays an ordinary line, so no amount
 * is ever dropped. `form` is the fallback for a gift carrying no `giftForm`.
 * `acceptsZeroValueLine` is the provider's declaration; `show-zero` degrades to
 * `technical-cent` unless it is `true`.
 */
export function presentGiftLines<T extends GiftPresentationLine>(
  lines: readonly T[],
  form: GiftLineForm,
  acceptsZeroValueLine: boolean | undefined,
  options: { currency?: string | null } = {},
): GiftPresentationResult<T> {
  const factor = 10 ** minorUnitExponentFor(options.currency);
  const toMinor = (value: number): number => Math.round(value * factor);
  const fromMinor = (minor: number): number => minor / factor;

  const entries: Entry<T>[] = lines.map((line) => ({
    source: line,
    gift: line.isGift === true && toMinor(line.unitPriceGross) === 0,
    lines: [line],
  }));

  const notes: GiftPresentationNote[] = [];
  const internalRecordLines: T[] = [];
  if (!entries.some((entry) => entry.gift)) {
    return {
      lines: floorZeroValueLines([...lines], acceptsZeroValueLine, toMinor, fromMinor, notes),
      internalRecordLines,
      appliedForm: form,
      notes,
    };
  }

  const paid = entries.filter((entry) => !entry.gift);
  const entryTotal = (entry: Entry<T>): number =>
    entry.lines.reduce((sum, line) => sum + line.quantity * toMinor(line.unitPriceGross), 0);

  const setEntryTotal = (entry: Entry<T>, totalMinor: number): void => {
    entry.lines = reexpressTotal(entry.source, totalMinor, fromMinor);
  };

  const largest = (candidates: readonly Entry<T>[]): Entry<T> | undefined =>
    candidates.reduce<Entry<T> | undefined>(
      (best, entry) => (best === undefined || entryTotal(entry) > entryTotal(best) ? entry : best),
      undefined,
    );

  // priced-in: share the paid total with the gifts by reference price, and take
  // the gift share off the paid lines in proportion to what they cost. The
  // rounding remainder goes to the largest paid line, once (D3).
  const priceIn = (giftEntries: Entry<T>[]): Entry<T>[] => {
    const weights = giftEntries.map((entry) =>
      Math.max(0, toMinor(entry.source.referenceUnitPriceGross ?? 0)) * entry.source.quantity,
    );
    const paidTotals = paid.map(entryTotal);
    const paidSum = paidTotals.reduce((a, b) => a + b, 0);
    const giftWeight = weights.reduce((a, b) => a + b, 0);
    const unpriced: Entry<T>[] = [];
    if (paid.length === 0 || paidSum <= 0 || giftWeight <= 0) {
      notes.push('no-reference-price');
      return giftEntries;
    }
    const share = Math.round((paidSum * giftWeight) / (paidSum + giftWeight));
    let taken = 0;
    giftEntries.forEach((entry, index) => {
      if (weights[index] === 0) {
        notes.push('no-reference-price');
        unpriced.push(entry);
        return;
      }
      const wanted = Math.round((share * weights[index]) / giftWeight);
      const quantity = entry.source.quantity;
      const unit = Number.isInteger(quantity) && quantity >= 1 ? Math.floor(wanted / quantity) : 0;
      entry.lines = [{ ...entry.source, unitPriceGross: fromMinor(unit) }];
      taken += unit * quantity;
    });
    const reductions = paidTotals.map((total) => Math.round((taken * total) / paidSum));
    const residual = taken - reductions.reduce((a, b) => a + b, 0);
    const largestIndex = paidTotals.indexOf(Math.max(...paidTotals));
    reductions[largestIndex] += residual;
    paid.forEach((entry, index) => setEntryTotal(entry, paidTotals[index] - reductions[index]));
    return unpriced;
  };

  const giftEntries = entries.filter((entry) => entry.gift);
  const toPriceIn: Entry<T>[] = [];
  const toDrop: Entry<T>[] = [];
  const applied: GiftLineForm[] = [];

  for (const entry of giftEntries) {
    // An unrecognised per-gift value must not reach the final branch below, which
    // prices a gift in: it falls back to the connection/global form instead.
    let effective: GiftLineForm = isGiftLineForm(entry.source.giftForm)
      ? entry.source.giftForm
      : form;
    if (effective === 'show-zero' && acceptsZeroValueLine !== true) {
      effective = 'technical-cent';
      notes.push('show-not-offered');
    }
    if (effective === 'internal-record') {
      internalRecordLines.push(entry.source);
      toDrop.push(entry);
    } else if (effective === 'omit') {
      toDrop.push(entry);
    } else if (effective === 'show-zero') {
      // the line stays at 0,00 untouched.
    } else if (effective === 'technical-cent' || effective === 'custom-price') {
      // The gift's price per unit (one minor unit for technical-cent, the chosen
      // amount for custom-price) is taken from the most expensive paid line,
      // whatever its rate; with none able to spare it the gift is priced in
      // instead and the note names why.
      const customUnit = toMinor(entry.source.giftUnitPriceGross ?? 0);
      if (effective === 'custom-price' && customUnit < 1) {
        notes.push('custom-price-invalid');
        effective = 'technical-cent';
      }
      const unitMinor = effective === 'custom-price' ? customUnit : 1;
      const need =
        Number.isInteger(entry.source.quantity) && entry.source.quantity >= 1
          ? entry.source.quantity * unitMinor
          : 0;
      // A donor must keep at least one minor unit per unit after giving, or its
      // own line would become a 0.00 row.
      const donor =
        need > 0
          ? largest(paid.filter((p) => entryTotal(p) - need >= p.source.quantity))
          : undefined;
      if (donor !== undefined) {
        setEntryTotal(donor, entryTotal(donor) - need);
        entry.lines = [{ ...entry.source, unitPriceGross: fromMinor(unitMinor) }];
      } else {
        notes.push(
          effective === 'custom-price' ? 'custom-price-no-donor' : 'technical-cent-no-donor',
        );
        effective = 'priced-in';
        toPriceIn.push(entry);
      }
    } else {
      toPriceIn.push(entry);
    }
    applied.push(effective);
  }

  if (toPriceIn.length > 0) {
    toDrop.push(...priceIn(toPriceIn));
  }

  const dropped = new Set(toDrop);
  const resultLines = floorZeroValueLines(
    entries.filter((entry) => !dropped.has(entry)).flatMap((entry) => entry.lines),
    acceptsZeroValueLine,
    toMinor,
    fromMinor,
    notes,
  );
  return { lines: resultLines, internalRecordLines, appliedForm: applied[0] ?? form, notes };
}

/**
 * Re-express a line as exactly `totalMinor`. A per-unit price cannot always
 * carry it (D2): n-1 units at the rounded price plus one unit carrying the
 * difference, only when needed.
 */
function reexpressTotal<T extends GiftPresentationLine>(
  base: T,
  totalMinor: number,
  fromMinor: (minor: number) => number,
): T[] {
  const quantity = base.quantity;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return [{ ...base, unitPriceGross: fromMinor(Math.round(totalMinor / quantity)) }];
  }
  const unit = Math.floor(totalMinor / quantity);
  const remainder = totalMinor - unit * quantity;
  if (remainder === 0) return [{ ...base, unitPriceGross: fromMinor(unit) }];
  if (quantity === 1) return [{ ...base, unitPriceGross: fromMinor(totalMinor) }];
  return [
    { ...base, quantity: quantity - 1, unitPriceGross: fromMinor(unit) },
    { ...base, quantity: 1, unitPriceGross: fromMinor(unit + remainder) },
  ];
}

/**
 * A provider that does not accept a zero-value line must never receive one.
 * Each zero line gets one minor unit per unit, taken from the largest paid line
 * of the SAME rate that can spare it; with none, the line stays and the note
 * `zero-line-unfloorable` names it, so the caller can refuse or log it.
 */
function floorZeroValueLines<T extends GiftPresentationLine>(
  lines: T[],
  acceptsZeroValueLine: boolean | undefined,
  toMinor: (value: number) => number,
  fromMinor: (minor: number) => number,
  notes: GiftPresentationNote[],
): T[] {
  if (acceptsZeroValueLine === true) return lines;
  const result = [...lines];
  for (let index = 0; index < result.length; index += 1) {
    const line = result[index];
    if (toMinor(line.unitPriceGross) !== 0 || !(line.quantity > 0)) continue;
    const need = Number.isInteger(line.quantity) ? line.quantity : 1;
    let donorIndex = -1;
    let donorTotal = 0;
    result.forEach((candidate, candidateIndex) => {
      if (candidate.isGift === true || rateKey(candidate.taxRate) !== rateKey(line.taxRate)) return;
      const total = candidate.quantity * toMinor(candidate.unitPriceGross);
      if (total - need >= candidate.quantity && total > donorTotal) {
        donorTotal = total;
        donorIndex = candidateIndex;
      }
    });
    if (donorIndex < 0) {
      notes.push('zero-line-unfloorable');
      continue;
    }
    const donor = result[donorIndex];
    const donorLines = reexpressTotal(donor, donorTotal - need, fromMinor);
    result[index] = { ...line, unitPriceGross: fromMinor(1) };
    result.splice(donorIndex, 1, ...donorLines);
    // The donor may have split into two lines; indexes after it shifted.
    if (donorIndex < index) index += donorLines.length - 1;
  }
  return result;
}
