/**
 * A bundle on a sales document (#3934)
 *
 * The form is decided by the data, never by an operator setting (product
 * decision A, ADR-083). Research basis, not legal advice: a set of goods with
 * different tax rates is separate supplies, each taxed at its OWN rate, and the
 * set price has to be split reasonably - proportionally to standalone prices is
 * the accepted method, an equal-percentage cut of every component. One line
 * "set" is acceptable only when every component carries the same rate. On a
 * fiscal receipt a name is bound to one rate on the register, so a component must
 * appear under its own name at its own rate.
 *
 * - every component's catalogue rate equals the set line's rate: the set stays
 *   ONE line at the price the buyer paid (unchanged);
 * - the rates differ: the set is presented as its components, each at its own
 *   catalogue rate, the paid price split by standalone price (cost when a
 *   component is not sold alone), the remainder on the largest, the discount
 *   built into unit prices (never a negative line, never a 0.00 paid line);
 * - a component's rate, or both its price and cost, is unknown: nothing is
 *   guessed. {@link BundleSplitUnknownError} is thrown and the caller holds the
 *   document with the named reason `bundle-split-unknown`.
 *
 * A gift slot component is priced 0 and goes through `presentGiftLines`
 * afterwards, like any gift, at its own rate.
 *
 * Pure and import-free beyond the minor-unit helper. It moves amounts between
 * figures the source reported and computes no tax (ADR-063): the component
 * rates are catalogue facts supplied by the caller. The component data (names,
 * standalone prices, cost, rate) is an ARGUMENT, resolved from the frozen
 * expansion, so this stays free of any sibling context.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import type { GiftDocumentFormChoice, GiftPresentationLine } from './gift-lines.types';
import { minorUnitExponentFor } from './shipping-tax-split.types';

/** Why a bundle could not be presented without guessing. */
export const BundleSplitUnknownReasonValues = [
  'component-rate-unknown',
  'component-value-unknown',
] as const;
export type BundleSplitUnknownReason = (typeof BundleSplitUnknownReasonValues)[number];

/**
 * A set that cannot be presented honestly. Carries ids and a closed reason
 * only (PII-free), because it reaches an operator badge as the block detail.
 */
export class BundleSplitUnknownError extends Error {
  constructor(
    readonly lineId: string,
    readonly reason: BundleSplitUnknownReason,
  ) {
    super(
      reason === 'component-rate-unknown'
        ? `Bundle line ${lineId} has a component with no known tax rate; it cannot be presented on a document without guessing one`
        : `Bundle line ${lineId} has a component with neither a price nor a cost to split the paid price by`,
    );
    this.name = 'BundleSplitUnknownError';
  }
}

/** One component of a bundle line, as a document needs it. */
export interface DocumentBundleComponent {
  /** The physical line id, `{lineId}~c:{variantId}`. */
  lineId: string;
  variantId: string;
  productId: string;
  name: string | null;
  sku?: string | null;
  /** Units of this component for the WHOLE bundle line. */
  quantity: number;
  giftSlot?: boolean;
  /** The gift slot's own form on a document (#3940); absent means "as in settings". */
  giftDocumentForm?: GiftDocumentFormChoice;
  /** Standalone gross unit price, the weight the paid price is split by. */
  unitPriceGross?: number | null;
  /** Net unit cost: the fallback weight, and the reference price of a gift. */
  unitCostNet?: number | null;
  /**
   * The component's catalogue tax rate (percent-as-string code, ADR-063).
   * Absent or blank means unknown, which holds the document.
   */
  taxRate?: string | null;
}

/** What a caller hands a mapper: the components per bundle line id. */
export interface BundleDocumentPresentation {
  byLineId: Record<string, DocumentBundleComponent[]>;
}

export interface BundleComponentLineInput {
  component: DocumentBundleComponent;
  quantity: number;
  unitPriceGross: number;
  /** The component's own catalogue rate. */
  taxRate: string;
  isGift: boolean;
  referenceUnitPriceGross?: number;
}

function rateKey(rate: string): string {
  const trimmed = rate.trim();
  return /^\d+(\.\d+)?$/.test(trimmed) ? String(Number(trimmed)) : trimmed.toLowerCase();
}

/**
 * Present each bundle line as one line or as its components, by the automatic
 * rule above. `makeLine` builds the document line type of the caller from the
 * set line. Throws {@link BundleSplitUnknownError} rather than guess.
 */
export function presentBundleComponents<T extends GiftPresentationLine>(
  lines: readonly T[],
  lineIdOf: (line: T) => string | undefined,
  presentation: BundleDocumentPresentation | undefined,
  makeLine: (parent: T, input: BundleComponentLineInput) => T,
  options: { currency?: string | null } = {},
): { lines: T[] } {
  if (presentation === undefined) {
    return { lines: [...lines] };
  }
  const factor = 10 ** minorUnitExponentFor(options.currency);
  const toMinor = (value: number): number => Math.round(value * factor);
  const fromMinor = (minor: number): number => minor / factor;
  const out: T[] = [];

  for (const line of lines) {
    const lineId = lineIdOf(line);
    const components = lineId === undefined ? undefined : presentation.byLineId[lineId];
    if (lineId === undefined || components === undefined || components.length === 0) {
      out.push(line);
      continue;
    }
    const rates = components.map((c) => c.taxRate?.trim() ?? '');
    if (rates.some((rate) => rate === '')) {
      throw new BundleSplitUnknownError(lineId, 'component-rate-unknown');
    }
    if (rates.every((rate) => rateKey(rate) === rateKey(line.taxRate))) {
      out.push(line);
      continue;
    }

    const paid = components.filter((c) => c.giftSlot !== true);
    const weights = weightsFor(paid, toMinor);
    if (paid.length === 0 || weights === null || !(line.quantity > 0)) {
      throw new BundleSplitUnknownError(lineId, 'component-value-unknown');
    }
    const total = Math.round(line.quantity * toMinor(line.unitPriceGross));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((w) => Math.floor((total * w) / weightSum));
    const largest = weights.indexOf(Math.max(...weights));
    shares[largest] += total - shares.reduce((a, b) => a + b, 0);

    components.forEach((component, index) => {
      const taxRate = rates[index];
      if (component.giftSlot === true) {
        const reference = component.unitPriceGross ?? component.unitCostNet ?? undefined;
        out.push(
          makeLine(line, {
            component,
            quantity: component.quantity,
            unitPriceGross: 0,
            taxRate,
            isGift: true,
            ...(reference !== undefined && reference !== null && { referenceUnitPriceGross: reference }),
          }),
        );
        return;
      }
      const share = shares[paid.indexOf(component)];
      const quantity = component.quantity;
      if (!Number.isInteger(quantity) || quantity < 1) {
        out.push(
          makeLine(line, {
            component,
            quantity,
            unitPriceGross: fromMinor(Math.round(share / quantity)),
            taxRate,
            isGift: false,
          }),
        );
        return;
      }
      const unit = Math.floor(share / quantity);
      const remainder = share - unit * quantity;
      // A per-unit price cannot always carry the share exactly: n-1 units at
      // the rounded price plus one carrying the difference, only when needed.
      if (remainder === 0 || quantity === 1) {
        out.push(
          makeLine(line, {
            component,
            quantity,
            unitPriceGross: fromMinor(quantity === 1 ? share : unit),
            taxRate,
            isGift: false,
          }),
        );
      } else {
        out.push(
          makeLine(line, { component, quantity: quantity - 1, unitPriceGross: fromMinor(unit), taxRate, isGift: false }),
          makeLine(line, { component, quantity: 1, unitPriceGross: fromMinor(unit + remainder), taxRate, isGift: false }),
        );
      }
    });
  }
  return { lines: out };
}

/**
 * Split weights for the PAID components: standalone prices when every one has
 * one, else costs when every one has one (a ratio is all that is needed), else
 * `null` (nothing to split by). Mixing the two would skew the ratio.
 */
function weightsFor(
  paid: readonly DocumentBundleComponent[],
  toMinor: (value: number) => number,
): number[] | null {
  const by = (pick: (c: DocumentBundleComponent) => number | null | undefined): number[] | null => {
    const weights = paid.map((c) => {
      const value = pick(c);
      return typeof value === 'number' && value > 0 ? toMinor(value) * c.quantity : 0;
    });
    return weights.length > 0 && weights.every((w) => w > 0) ? weights : null;
  };
  return by((c) => c.unitPriceGross) ?? by((c) => c.unitCostNet);
}
