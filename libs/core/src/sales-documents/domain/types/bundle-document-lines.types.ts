/**
 * A bundle on a sales document (#3934)
 *
 * By default a bundle is ONE document line at the price the buyer paid for the
 * set (`one-line`, unchanged). With `components` the set line is replaced by
 * its components and the paid price is split between them by standalone price,
 * so the document total still equals what was paid. A gift slot component is
 * priced 0 and goes through `presentGiftLines` afterwards, like any gift.
 *
 * Pure and import-free beyond the minor-unit helper. It moves amounts between
 * figures the source reported and computes no tax (ADR-063): every component
 * line keeps the rate of the set line it came from, which is what keeps the
 * per-rate sums equal to what was paid. The component data (names, standalone
 * prices, cost) is an ARGUMENT, resolved by the caller from the frozen
 * expansion, so this stays free of any sibling context.
 *
 * Setting: `config.giftOnDocuments.bundleForm` on the ORDER-SOURCE connection,
 * next to the gift form. It lives inside the existing object on purpose: one
 * knob family, no new connection config key.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import { GIFT_ON_DOCUMENTS_CONFIG_KEY, type GiftPresentationLine } from './gift-lines.types';
import { minorUnitExponentFor } from './shipping-tax-split.types';

export const BundleDocumentFormValues = ['one-line', 'components'] as const;
export type BundleDocumentForm = (typeof BundleDocumentFormValues)[number];

export const DEFAULT_BUNDLE_DOCUMENT_FORM: BundleDocumentForm = 'one-line';

/**
 * Read `config.giftOnDocuments.bundleForm`. Never throws; anything unrecognised
 * is `one-line`, because a typo must not change what a fiscal document says.
 */
export function readBundleDocumentForm(config: unknown): BundleDocumentForm {
  if (typeof config !== 'object' || config === null) return DEFAULT_BUNDLE_DOCUMENT_FORM;
  const raw = (config as Record<string, unknown>)[GIFT_ON_DOCUMENTS_CONFIG_KEY];
  if (typeof raw !== 'object' || raw === null) return DEFAULT_BUNDLE_DOCUMENT_FORM;
  const form = (raw as Record<string, unknown>).bundleForm;
  return typeof form === 'string' && (BundleDocumentFormValues as readonly string[]).includes(form)
    ? (form as BundleDocumentForm)
    : DEFAULT_BUNDLE_DOCUMENT_FORM;
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
  /** Standalone gross unit price, the weight the paid price is split by. */
  unitPriceGross?: number | null;
  /** Net unit cost: the fallback weight, and the reference price of a gift. */
  unitCostNet?: number | null;
}

/** What a caller hands a mapper: the form and the components per bundle line id. */
export interface BundleDocumentPresentation {
  form: BundleDocumentForm;
  byLineId: Record<string, DocumentBundleComponent[]>;
}

export interface BundleDocumentNote {
  /** `bundle-split-missing`: no usable price or cost, so the set stays one line. */
  code: 'bundle-split-missing';
  lineId: string;
}

export interface BundleComponentLineInput {
  component: DocumentBundleComponent;
  quantity: number;
  unitPriceGross: number;
  isGift: boolean;
  referenceUnitPriceGross?: number;
}

/**
 * Replace each bundle line by its components when the form is `components`.
 * `makeLine` builds the document line type of the caller from the set line.
 * A set that cannot be split falls back to its one line and is reported.
 */
export function presentBundleComponents<T extends GiftPresentationLine>(
  lines: readonly T[],
  lineIdOf: (line: T) => string | undefined,
  presentation: BundleDocumentPresentation | undefined,
  makeLine: (parent: T, input: BundleComponentLineInput) => T,
  options: { currency?: string | null } = {},
): { lines: T[]; notes: BundleDocumentNote[] } {
  if (presentation === undefined || presentation.form !== 'components') {
    return { lines: [...lines], notes: [] };
  }
  const factor = 10 ** minorUnitExponentFor(options.currency);
  const toMinor = (value: number): number => Math.round(value * factor);
  const fromMinor = (minor: number): number => minor / factor;
  const notes: BundleDocumentNote[] = [];
  const out: T[] = [];

  for (const line of lines) {
    const lineId = lineIdOf(line);
    const components = lineId === undefined ? undefined : presentation.byLineId[lineId];
    if (lineId === undefined || components === undefined || components.length === 0) {
      out.push(line);
      continue;
    }
    const paid = components.filter((c) => c.giftSlot !== true);
    const weights = weightsFor(paid, toMinor);
    if (paid.length === 0 || weights === null || !(line.quantity > 0)) {
      notes.push({ code: 'bundle-split-missing', lineId });
      out.push(line);
      continue;
    }
    const total = Math.round(line.quantity * toMinor(line.unitPriceGross));
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((w) => Math.floor((total * w) / weightSum));
    const largest = weights.indexOf(Math.max(...weights));
    shares[largest] += total - shares.reduce((a, b) => a + b, 0);

    for (const component of components) {
      if (component.giftSlot === true) {
        const reference = component.unitPriceGross ?? component.unitCostNet ?? undefined;
        out.push(
          makeLine(line, {
            component,
            quantity: component.quantity,
            unitPriceGross: 0,
            isGift: true,
            ...(reference !== undefined && reference !== null && { referenceUnitPriceGross: reference }),
          }),
        );
        continue;
      }
      const share = shares[paid.indexOf(component)];
      const quantity = component.quantity;
      if (!Number.isInteger(quantity) || quantity < 1) {
        out.push(
          makeLine(line, {
            component,
            quantity,
            unitPriceGross: fromMinor(Math.round(share / quantity)),
            isGift: false,
          }),
        );
        continue;
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
            isGift: false,
          }),
        );
      } else {
        out.push(
          makeLine(line, { component, quantity: quantity - 1, unitPriceGross: fromMinor(unit), isGift: false }),
          makeLine(line, { component, quantity: 1, unitPriceGross: fromMinor(unit + remainder), isGift: false }),
        );
      }
    }
  }
  return { lines: out, notes };
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
