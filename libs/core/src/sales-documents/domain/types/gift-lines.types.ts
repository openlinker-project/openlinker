/**
 * Gift lines on a sales document (#3930)
 *
 * `presentGiftLines` turns order lines into document lines so the document
 * total always equals what the buyer paid, whatever form the operator chose for
 * a gift. Pure and import-free beyond the minor-unit helper: it moves amounts
 * between figures the source reported and computes no tax (ADR-063).
 *
 * Forms (rules D1-D4, C3 of the bundles-and-gifts spike):
 * - `omit` (default): the gift is not on the document.
 * - `show`: the gift is a 0,00 line. A provider that refuses zero (a fiscal
 *   register rejects a zero-value line) gets one minor unit taken from a paid
 *   line of the SAME rate; with no such line the gift is handled like a gift of
 *   a different rate (see below).
 * - `priced-in`: part of the payment moves to the gift, in proportion to
 *   reference prices, each line keeping its own rate.
 * - `internal-record`: off the customer document, returned separately so the
 *   caller can record a free transfer.
 *
 * A gift whose rate matches no paid line is never silently dropped (product
 * decision B, ADR-083). Research basis, not legal advice: a gift tied to a
 * purchase is part of the paid sale, so leaving it off lets the whole payment
 * be taxed at the paid lines' rates, and shifting value away from a
 * higher-rate item is the direction the tax authority warns about. The
 * operator chooses how it is carried (`config.giftOnDocuments.differentRateGift`):
 * - `priced-in` (default): the gift at its own rate with a share of the
 *   payment proportional to its standalone price (cost when not sold alone);
 * - `technical-cent`: the gift at 0.01 per unit, the cent taken from the
 *   largest paid line (common marketplace-tool practice).
 * There is deliberately NO "hold every document with a gift" option (rule C3).
 *
 * Whenever the provider does not accept a zero-value line, no presented line is
 * left at 0.00: one minor unit per unit is taken from the largest paid line of
 * the same rate, or the line is reported as `zero-line-unfloorable`.
 *
 * Settings live on the ORDER-SOURCE connection (`config.giftOnDocuments`), the
 * ADR-082 shape; the default form is `omit`.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { minorUnitExponentFor } from './shipping-tax-split.types';

/** Config key on the order-source `Connection.config`. */
export const GIFT_ON_DOCUMENTS_CONFIG_KEY = 'giftOnDocuments';

export const GiftLineFormValues = ['omit', 'show', 'priced-in', 'internal-record'] as const;
export type GiftLineForm = (typeof GiftLineFormValues)[number];

export const DEFAULT_GIFT_LINE_FORM: GiftLineForm = 'omit';

/**
 * Read `config.giftOnDocuments.form`. Never throws; anything unrecognised is the
 * default, because a typo must not change what a fiscal document says.
 */
export function readGiftLineForm(config: unknown): GiftLineForm {
  if (typeof config !== 'object' || config === null) return DEFAULT_GIFT_LINE_FORM;
  const raw = (config as Record<string, unknown>)[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return DEFAULT_GIFT_LINE_FORM;
  const form = (raw as Record<string, unknown>).form;
  return typeof form === 'string' && (GiftLineFormValues as readonly string[]).includes(form)
    ? (form as GiftLineForm)
    : DEFAULT_GIFT_LINE_FORM;
}

export const DifferentRateGiftValues = ['priced-in', 'technical-cent'] as const;
export type DifferentRateGift = (typeof DifferentRateGiftValues)[number];

export const DEFAULT_DIFFERENT_RATE_GIFT: DifferentRateGift = 'priced-in';

/** Read `config.giftOnDocuments.differentRateGift`; anything unrecognised is the default. */
export function readDifferentRateGift(config: unknown): DifferentRateGift {
  if (typeof config !== 'object' || config === null) return DEFAULT_DIFFERENT_RATE_GIFT;
  const raw = (config as Record<string, unknown>)[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return DEFAULT_DIFFERENT_RATE_GIFT;
  const value = (raw as Record<string, unknown>).differentRateGift;
  return typeof value === 'string' && (DifferentRateGiftValues as readonly string[]).includes(value)
    ? (value as DifferentRateGift)
    : DEFAULT_DIFFERENT_RATE_GIFT;
}

/** Both gift settings of a connection, named like the mapper inputs they feed. */
export interface GiftDocumentSettings {
  giftForm: GiftLineForm;
  differentRateGift: DifferentRateGift;
}

export function readGiftDocumentSettings(config: unknown): GiftDocumentSettings {
  return {
    giftForm: readGiftLineForm(config),
    differentRateGift: readDifferentRateGift(config),
  };
}

/**
 * Strict write-side check for `config.giftOnDocuments`. The READ side forgives
 * anything (a stored value must never break an issuance); strictness belongs
 * here, where there is an operator to tell. Returns one message per problem,
 * all of them at once.
 */
export function validateGiftOnDocumentsShape(value: unknown): { path: string; message: string }[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: GIFT_ON_DOCUMENTS_CONFIG_KEY, message: 'must be an object' }];
  }
  const errors: { path: string; message: string }[] = [];
  const record = value as Record<string, unknown>;
  const form = record.form;
  if (typeof form !== 'string' || !(GiftLineFormValues as readonly string[]).includes(form)) {
    errors.push({
      path: `${GIFT_ON_DOCUMENTS_CONFIG_KEY}.form`,
      message: `must be one of ${GiftLineFormValues.join(', ')}`,
    });
  }
  const different = record.differentRateGift;
  if (
    different !== undefined &&
    (typeof different !== 'string' || !(DifferentRateGiftValues as readonly string[]).includes(different))
  ) {
    errors.push({
      path: `${GIFT_ON_DOCUMENTS_CONFIG_KEY}.differentRateGift`,
      message: `must be one of ${DifferentRateGiftValues.join(', ')}`,
    });
  }
  return errors;
}

/** The forms an operator may pick for a provider; `show` needs a declaration. */
export function offeredGiftLineForms(
  acceptsZeroValueLine: boolean | undefined,
): readonly GiftLineForm[] {
  return acceptsZeroValueLine === undefined
    ? GiftLineFormValues.filter((form) => form !== 'show')
    : GiftLineFormValues;
}

/** The slice of a document line the helper reads and rewrites. */
export interface GiftPresentationLine {
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
  /** Set by the caller from the order line's `gift` marker. */
  isGift?: boolean;
  /**
   * What one unit would cost on its own, gross. Only `priced-in` reads it, as
   * the weight the payment is shared by; without it a gift carries no value to
   * price in and falls back to `omit`.
   */
  referenceUnitPriceGross?: number;
}

export type GiftPresentationNote =
  | 'show-not-offered'
  | 'rate-not-on-document'
  | 'no-same-rate-paid-line'
  | 'no-reference-price'
  | 'technical-cent-no-donor'
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
 * Present the gift lines of an order as the chosen form.
 *
 * Only a line marked `isGift` AND priced 0 is a gift: a marked line the source
 * priced above zero carries real money and stays an ordinary line, so no amount
 * is ever dropped. `acceptsZeroValueLine` is the provider's declaration; absent
 * (`undefined`) means `show` is not offered and resolves to `omit`.
 */
export function presentGiftLines<T extends GiftPresentationLine>(
  lines: readonly T[],
  form: GiftLineForm,
  acceptsZeroValueLine: boolean | undefined,
  options: { currency?: string | null; differentRateGift?: DifferentRateGift } = {},
): GiftPresentationResult<T> {
  const differentRateGift = options.differentRateGift ?? DEFAULT_DIFFERENT_RATE_GIFT;
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

  let effective: GiftLineForm = form;
  if (form === 'show' && acceptsZeroValueLine === undefined) {
    effective = 'omit';
    notes.push('show-not-offered');
  }

  const paid = entries.filter((entry) => !entry.gift);
  const entryTotal = (entry: Entry<T>): number =>
    entry.lines.reduce((sum, line) => sum + line.quantity * toMinor(line.unitPriceGross), 0);
  const paidRates = new Set(paid.map((entry) => rateKey(entry.source.taxRate)));

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

  // A gift whose rate no paid line carries (decision B): the operator's choice,
  // never a silent drop. `technical-cent` falls back to `priced-in` when no
  // paid line can spare the cent.
  const handleDifferentRate = (entry: Entry<T>): void => {
    if (differentRateGift === 'technical-cent') {
      const need = Number.isInteger(entry.source.quantity) && entry.source.quantity >= 1 ? entry.source.quantity : 0;
      const donor = need > 0 ? largest(paid.filter((p) => entryTotal(p) > need)) : undefined;
      if (donor !== undefined) {
        setEntryTotal(donor, entryTotal(donor) - need);
        entry.lines = [{ ...entry.source, unitPriceGross: fromMinor(1) }];
        return;
      }
      notes.push('technical-cent-no-donor');
    }
    toPriceIn.push(entry);
  };

  for (const entry of giftEntries) {
    const sameRate = paid.filter((p) => rateKey(p.source.taxRate) === rateKey(entry.source.taxRate));
    const rateMismatch = paid.length > 0 && !paidRates.has(rateKey(entry.source.taxRate));
    const zeroKept = effective === 'show' && acceptsZeroValueLine === true;
    if (effective === 'internal-record') {
      internalRecordLines.push(entry.source);
      toDrop.push(entry);
    } else if (rateMismatch && !zeroKept) {
      notes.push('rate-not-on-document');
      handleDifferentRate(entry);
    } else if (effective === 'priced-in') {
      toPriceIn.push(entry);
    } else if (effective === 'omit') {
      toDrop.push(entry);
    } else if (zeroKept) {
      // show, provider accepts zero: the line stays at 0,00 untouched.
    } else {
      // show, provider refuses zero: one minor unit per gift unit from the
      // largest same-rate paid line that can spare it.
      const need = Number.isInteger(entry.source.quantity) ? entry.source.quantity : 1;
      const donor = largest(sameRate.filter((p) => entryTotal(p) > need));
      if (donor === undefined) {
        notes.push('no-same-rate-paid-line');
        toPriceIn.push(entry);
      } else {
        setEntryTotal(donor, entryTotal(donor) - need);
        entry.lines = [{ ...entry.source, unitPriceGross: fromMinor(1) }];
      }
    }
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
  const priced = toPriceIn.length > 0 && !toPriceIn.every((entry) => dropped.has(entry));
  const appliedForm: GiftLineForm =
    effective === 'omit' && priced ? 'priced-in' : effective;
  return { lines: resultLines, internalRecordLines, appliedForm, notes };
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
      if (total > need && total > donorTotal) {
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
