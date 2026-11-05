/**
 * Gift lines on a sales document (#3930, redecided by #3941)
 *
 * `presentGiftLines` turns order lines into document lines so the document
 * total always equals what the buyer paid, whatever form was chosen for a gift.
 * Pure and import-free beyond the minor-unit helper: it moves amounts between
 * figures the source reported and computes no tax (ADR-063).
 *
 * ONE choice, the gift form on documents (gifts spec section 8.2):
 * - `technical-cent` (default): the gift at 0.01 per unit, the cent taken from
 *   the most expensive paid line whatever its rate;
 * - `priced-in`: a share of the payment proportional to the gift's reference
 *   price, each line keeping its own rate;
 * - `show-zero`: the gift at 0.00, only where the provider declares it accepts
 *   a zero-value line; otherwise it degrades to `technical-cent` (noted);
 * - `omit`: the gift is not on the document;
 * - `internal-record` (not offered in the UI): off the customer document,
 *   returned separately so the caller can record a free transfer.
 *
 * Three levels, most specific wins (section 8.3): the gift's own form, the
 * connection's override, the OpenLinker-wide default. `resolveGiftDocumentForm`
 * is the one place that decides, and reports where the answer came from.
 * Research basis, not legal advice.
 *
 * A provider that does not accept a zero-value line never receives one: one
 * minor unit per unit is taken from the largest paid line of the same rate, or
 * the line is reported as `zero-line-unfloorable`.
 *
 * Connection override: `config.giftOnDocuments.form` (absent = inherit). A
 * stored `differentRateGift` from the earlier model is ignored: `technical-cent`
 * always takes the cent from the most expensive paid line, so a gift whose rate
 * matches no paid line needs no extra setting.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { minorUnitExponentFor } from './shipping-tax-split.types';

/** Config key on the order-source `Connection.config`. */
export const GIFT_ON_DOCUMENTS_CONFIG_KEY = 'giftOnDocuments';

/** The four forms an operator picks (gifts spec section 8.2). */
export const GiftDocumentFormChoiceValues = [
  'technical-cent',
  'priced-in',
  'show-zero',
  'omit',
] as const;
export type GiftDocumentFormChoice = (typeof GiftDocumentFormChoiceValues)[number];

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

export interface ResolvedGiftForm {
  form: GiftLineForm;
  source: GiftFormSource;
}

/**
 * Most specific wins: the gift's own form, then the connection's override, then
 * the OpenLinker-wide default. An unrecognised value at a level reads as absent.
 */
export function resolveGiftDocumentForm(
  lineForm: unknown,
  connectionForm: unknown,
  globalForm: unknown,
): ResolvedGiftForm {
  if (isGiftLineForm(lineForm)) return { form: lineForm, source: 'rule' };
  if (isGiftLineForm(connectionForm)) return { form: connectionForm, source: 'connection' };
  return {
    form: isGiftLineForm(globalForm) ? globalForm : DEFAULT_GIFT_LINE_FORM,
    source: 'default',
  };
}

/**
 * Read the connection override `config.giftOnDocuments.form`. `undefined` means
 * "inherit". Never throws. The earlier model's `show` reads as `show-zero`.
 */
export function readGiftConnectionForm(config: unknown): GiftLineForm | undefined {
  if (typeof config !== 'object' || config === null) return undefined;
  const raw = (config as Record<string, unknown>)[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const form = (raw as Record<string, unknown>).form;
  if (form === 'show') return 'show-zero';
  return isGiftLineForm(form) ? form : undefined;
}

/** What a mapper needs from the settings: the connection override and the global default. */
export interface GiftDocumentSettings {
  giftConnectionForm?: GiftLineForm;
  giftGlobalForm: GiftLineForm;
}

export function readGiftDocumentSettings(
  config: unknown,
  globalForm: GiftLineForm = DEFAULT_GIFT_LINE_FORM,
): GiftDocumentSettings {
  const connection = readGiftConnectionForm(config);
  return {
    ...(connection !== undefined && { giftConnectionForm: connection }),
    giftGlobalForm: globalForm,
  };
}

/**
 * Strict write-side check for `config.giftOnDocuments`. The READ side forgives
 * anything (a stored value must never break an issuance); strictness belongs
 * here, where there is an operator to tell. `form` is optional (absent = inherit
 * from OpenLinker); a legacy `differentRateGift` is accepted and ignored so an
 * existing config still saves.
 */
export function validateGiftOnDocumentsShape(value: unknown): { path: string; message: string }[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: GIFT_ON_DOCUMENTS_CONFIG_KEY, message: 'must be an object' }];
  }
  const form = (value as Record<string, unknown>).form;
  if (form === undefined || form === null || form === 'show') return [];
  if (!isGiftLineForm(form)) {
    return [
      {
        path: `${GIFT_ON_DOCUMENTS_CONFIG_KEY}.form`,
        message: `must be one of ${GiftLineFormValues.join(', ')}`,
      },
    ];
  }
  return [];
}

/** The forms an operator may pick for a provider; `show-zero` needs a declaration. */
export function offeredGiftLineForms(
  acceptsZeroValueLine: boolean | undefined,
): readonly GiftDocumentFormChoice[] {
  return acceptsZeroValueLine === true
    ? GiftDocumentFormChoiceValues
    : GiftDocumentFormChoiceValues.filter((form) => form !== 'show-zero');
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
    let effective: GiftLineForm = entry.source.giftForm ?? form;
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
    } else if (effective === 'technical-cent') {
      // One minor unit per gift unit from the most expensive paid line, whatever
      // its rate; with none able to spare it the gift is priced in instead.
      const need =
        Number.isInteger(entry.source.quantity) && entry.source.quantity >= 1
          ? entry.source.quantity
          : 0;
      const donor = need > 0 ? largest(paid.filter((p) => entryTotal(p) > need)) : undefined;
      if (donor !== undefined) {
        setEntryTotal(donor, entryTotal(donor) - need);
        entry.lines = [{ ...entry.source, unitPriceGross: fromMinor(1) }];
      } else {
        notes.push('technical-cent-no-donor');
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
