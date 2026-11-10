/**
 * Bulk wizard blocker chip descriptors (#1741, vocabulary reworked in #2240)
 *
 * Host-neutral labels + tones for the per-variant blocker chips, shared by the
 * Review step and the Edit modal so the two never drift (#1741 review #11).
 * Extracted into its own module (rather than exported from a component) to keep
 * the Review step <-> Edit modal import graph acyclic.
 *
 * The map stays one descriptor per blocker id, and #2240 keeps it that way. A
 * category failure has a CAUSE (which of four things went wrong) and an EFFECT
 * (no category was resolved). The cause is the blocker id and therefore the
 * chip; the effect is `CATEGORY_EFFECT_CHIP`, rendered only in the editor beside
 * the cause. Emitting the effect as a second blocker id would double the
 * vocabulary, add a chip present in 100% of category failures to a Review row
 * that already carries up to four, and - on a destination that resolves the
 * category server-side at submit - state something false.
 *
 * Every label and sentence reads the `listings.bulkBlockers` copy when it is
 * read (chip labels are getters), never at module load, so the words follow
 * the active language.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import {
  formatPlural,
  getLocale,
  getMessages,
  interpolate,
  type Messages,
  type ResolvedCopy,
} from '../../../../shared/i18n';
import type { StatusBadgeTone } from '../../../../shared/ui';
import type {
  OfferBlockerCopy,
  OfferBlockerDescribeContext,
  OfferBlockerDescriptor,
  OfferBlockerField,
} from '../../../../shared/plugins';
import type { BulkRowBlocker } from './bulk-wizard.types';

export type ChipDescriptor = {
  tone: StatusBadgeTone;
  label: string;
  fixable: boolean;
  /**
   * `true` for a chip that reports a risk we cannot confirm (#2243) - it shows
   * on the row but does NOT make it unready, so it never gates the batch.
   * Absent ⇒ blocking, so a chip that forgets the flag fails safe.
   */
  advisory?: boolean;
  /** Field the edit modal opens focused on when the chip is clicked (#2243). */
  field?: OfferBlockerField;
  /**
   * The chip is a LINK out of the app rather than a dotted-underline button
   * that opens the row editor (#2255). Used where the fix is not in OpenLinker
   * at all - a rate managed on the channel is set in the channel's own panel.
   *
   * Rendered underlined solid, the same carve-out `AlreadyListedChip` makes, so
   * it does not read as the editor affordance it is not.
   */
  link?: boolean;
  /** Platform-owned sentence for the blocker (#4003) - see `OfferBlockerDescriptor.describe`. */
  describe?: (context: OfferBlockerDescribeContext) => OfferBlockerCopy;
};

type BlockerCopyTree = ResolvedCopy<Messages['listings']>['bulkBlockers'];
type ChipKey = keyof BlockerCopyTree['chips'];

/** The blocker copy, read when it is used - never at module load. */
function blockerCopy(): BlockerCopyTree {
  return getMessages('listings').bulkBlockers;
}

/**
 * A descriptor whose `label` reads the active language each time it is read,
 * so the map can stay a constant while the words follow the locale.
 */
function chip(
  key: ChipKey,
  rest: Omit<ChipDescriptor, 'label'>,
): ChipDescriptor {
  return {
    ...rest,
    get label(): string {
      return blockerCopy().chips[key];
    },
  };
}

/** Host-neutral blocker chips - labels + tones verbatim from the design. */
export const NEUTRAL_BLOCKER_CHIPS: Record<string, ChipDescriptor> = {
  'no-variant': chip('noVariant', { tone: 'neutral', fixable: false }),
  'no-ean': chip('noEan', { tone: 'error', fixable: true, field: 'ean' }),
  'invalid-barcode': chip('invalidBarcode', { tone: 'error', fixable: true, field: 'ean' }),
  'no-match': chip('noMatch', { tone: 'error', fixable: true, field: 'category' }),
  'multi-match': chip('multiMatch', { tone: 'warning', fixable: true, field: 'category' }),
  'unknown-category-result': chip('unknownCategoryResult', {
    tone: 'error',
    fixable: true,
    field: 'category',
  }),
  // #3994 - a catalogue product matched the barcode in a different category
  // than the operator's mapping. The mapping was used, so nothing is wrong with
  // the row; the chip only says a catalogue product was set aside. Advisory:
  // the operator's own mapping is the answer, so it must never gate the batch.
  // The Review step shows it on the Category cell rather than as a status chip.
  'card-category-differs': chip('cardCategoryDiffers', {
    tone: 'warning',
    fixable: true,
    advisory: true,
    field: 'category',
  }),
  'no-master-price': chip('noMasterPrice', { tone: 'error', fixable: true, field: 'price' }),
  'no-master-stock': chip('noMasterStock', { tone: 'error', fixable: true }),
  'stock-unknown': chip('stockUnknown', { tone: 'error', fixable: true }),
  'currency-mismatch': chip('currencyMismatch', { tone: 'warning', fixable: true }),
  'already-listed': chip('alreadyListed', { tone: 'neutral', fixable: false }),
  // The category schema could not be fetched, so no bound could be checked
  // (#2243). Advisory: the marketplace stays the last word on those fields, and
  // refusing to submit over OUR failed request would be the wrong penalty.
  'params-not-checked': chip('paramsNotChecked', {
    tone: 'info',
    fixable: false,
    advisory: true,
  }),
  // #2255 - SOFT, like every other blocker here: the flagged rows are excluded
  // and the rest publish. A hard block would be a behaviour change to a shipped
  // component for no gain, since the document gate catches a rate-less sale
  // later anyway.
  'no-tax-rate': chip('noTaxRate', { tone: 'error', fixable: true }),
  // Not fixable in OpenLinker: the rate lives on the channel, so the chip is a
  // link out rather than an editor affordance.
  'tax-rate-on-channel': chip('taxRateOnChannel', {
    tone: 'neutral',
    fixable: false,
    link: true,
  }),
};

/**
 * The consequence chip that accompanies a category cause in the variant editor.
 * Deliberately NOT a blocker id - see the module header.
 */
export const CATEGORY_EFFECT_CHIP: ChipDescriptor = chip('categoryNotSet', {
  tone: 'error',
  fixable: true,
});

export const FALLBACK_CHIP: ChipDescriptor = chip('needsAttention', {
  tone: 'warning',
  fixable: true,
});

/**
 * The neutral chips plus the destination platform's own descriptors (#4003).
 * The ONE merge: the Review step, the wizard readiness and the edit modal all
 * read it, so a chip cannot be named on one surface and nameless on another,
 * and the descriptor's `field` and `describe` survive the merge (both were
 * previously dropped, so a plugin chip opened the editor unfocused).
 */
export function resolveBlockerChips(
  platformBlockers: readonly OfferBlockerDescriptor[],
): Record<string, ChipDescriptor> {
  const merged: Record<string, ChipDescriptor> = { ...NEUTRAL_BLOCKER_CHIPS };
  for (const chip of platformBlockers) {
    merged[chip.id] = {
      tone: chip.tone as StatusBadgeTone,
      label: chip.label,
      fixable: true,
      advisory: chip.advisory === true,
      ...(chip.field !== undefined ? { field: chip.field } : {}),
      ...(chip.describe !== undefined ? { describe: chip.describe } : {}),
    };
  }
  return merged;
}

export interface BlockerCopyContext {
  /** The effective barcode for the row, or null when it has none. */
  ean: string | null;
  /** Resolved destination display name (plugin `platform.displayName`). */
  destinationName: string;
  /** How many variants a product-tier category fix would cover. */
  variantCount: number;
  /** Batch currency, for the currency-mismatch sentence. */
  batchCurrency: string;
  /**
   * Set for a bundle row (#3520): the components the destination reported a
   * problem for, so the sentence can name them. `codes` are the destination's
   * own refusal codes.
   */
  bundle?: { componentsWithProblem: readonly { name: string; codes: readonly string[] }[] };
  /**
   * The resolved chips (neutral + the destination's own, #4003). A platform
   * blocker's sentence comes from its descriptor; without this the copy only
   * knows the neutral ids.
   */
  chips?: Record<string, ChipDescriptor>;
  /**
   * Missing required product parameters for the variant, three-state - see
   * `OfferBlockerDescribeContext.missingParameterNames`.
   */
  missingParameterNames?: readonly string[] | null;
}

export interface BlockerCopy {
  /** One sentence naming the cause and the offending value. */
  title: string;
  /** One sentence naming the consequence and/or the action. May be empty. */
  detail: string;
  /** Values the title refers to, rendered as a list (#4003). */
  items?: readonly string[];
}

/**
 * One sentence pair per blocker id, so the Review table (chip tooltip) and the
 * variant editor (banner) cannot drift (#2240). The sentences need values the
 * descriptor map has no access to: the offending barcode, the destination's
 * display name, how many variants a shared fix would cover.
 *
 * Two rules the copy follows:
 *
 * - **Name the value, name the action.** "manual category" told the operator
 *   neither which barcode failed nor what to do about it.
 * - **Say "not found", never "wrong".** A barcode can be a perfectly valid GTIN
 *   and still be absent from a destination's catalogue. A code that fails its own
 *   check digit is a different blocker with a different sentence.
 *
 * The destination is always interpolated from the resolved plugin's display
 * name - no marketplace is hardcoded, because these blockers are host-neutral.
 *
 * Unknown ids (platform-contributed, e.g. `allegro:title-too-long`) fall back to
 * their chip label plus a generic instruction.
 */
export function describeBlocker(blocker: string, ctx: BlockerCopyContext): BlockerCopy {
  const copy = blockerCopy().describe;
  const locale = getLocale();
  const ean = ctx.ean === null || ctx.ean === '' ? copy.thisBarcode : ctx.ean;
  const params = {
    ean,
    destination: ctx.destinationName,
    currency: ctx.batchCurrency,
  };
  switch (blocker) {
    case 'no-match':
      return {
        title: interpolate(copy.noMatch.title, params),
        // Deliberately does NOT offer "or just for this variant" as an
        // alternative: the editor's own save requires a category on the product,
        // so a per-variant override alone cannot be saved. The override is a
        // refinement of the shared value, and the editor offers it only once
        // that value exists (#2240).
        detail: formatPlural(ctx.variantCount, copy.noMatch.detail, locale),
      };
    case 'invalid-barcode':
      return {
        title: interpolate(copy.invalidBarcode.title, params),
        detail: copy.invalidBarcode.detail,
      };
    case 'no-ean':
      return {
        title: copy.noEan.title,
        detail: interpolate(copy.noEan.detail, params),
      };
    case 'multi-match':
      return {
        title: interpolate(copy.multiMatch.title, params),
        detail: copy.multiMatch.detail,
      };
    case 'unknown-category-result':
      return {
        title: interpolate(copy.unknownCategoryResult.title, params),
        detail: copy.unknownCategoryResult.detail,
      };
    case 'card-category-differs':
      return {
        title: interpolate(copy.cardCategoryDiffers.title, params),
        detail: copy.cardCategoryDiffers.detail,
      };
    case 'no-master-price':
      return { title: copy.noMasterPrice.title, detail: copy.noMasterPrice.detail };
    case 'no-master-stock':
      return { title: copy.noMasterStock.title, detail: copy.noMasterStock.detail };
    case 'stock-unknown':
      return {
        title: copy.stockUnknown.title,
        // A multi-variant sibling always lists at its master stock (#823/#824),
        // so a hand-set stock is not a remedy there; switching it off is.
        detail:
          ctx.variantCount > 1
            ? copy.stockUnknown.detailMultiVariant
            : copy.stockUnknown.detailSingleVariant,
      };
    case 'currency-mismatch':
      return {
        title: interpolate(copy.currencyMismatch.title, params),
        detail: interpolate(copy.currencyMismatch.detail, params),
      };
    case 'no-variant':
      return { title: copy.noVariant.title, detail: copy.noVariant.detail };
    default: {
      const bundleKind = bundleBlockerKind(blocker);
      if (bundleKind !== null) {
        return describeBundleBlocker(bundleKind, ctx);
      }
      const describe = ctx.chips?.[blocker]?.describe;
      if (describe) return describe({ missingParameterNames: ctx.missingParameterNames });
      return {
        title: interpolate(copy.fallback.title, { label: blockerLabel(blocker, ctx.chips) }),
        detail: copy.fallback.detail,
      };
    }
  }
}

type BundleBlockerKind = 'component-missing' | 'component-gpsr-missing' | 'category-mismatch';

/**
 * The bundle blockers a destination plugin declares are namespaced
 * (`allegro:bundle-component-missing`), so they are recognised by their suffix:
 * the sentences are the same for every destination that publishes a set, and a
 * new one adds no host id.
 */
function bundleBlockerKind(blocker: string): BundleBlockerKind | null {
  for (const kind of ['component-missing', 'component-gpsr-missing', 'category-mismatch'] as const) {
    if (blocker.endsWith(`:bundle-${kind}`)) return kind;
  }
  return null;
}

function describeBundleBlocker(kind: BundleBlockerKind, ctx: BlockerCopyContext): BlockerCopy {
  const copy = blockerCopy().describe;
  const named = (match: (code: string) => boolean): string =>
    (ctx.bundle?.componentsWithProblem ?? [])
      .filter((component) => component.codes.some(match))
      .map((component) => component.name)
      .join(', ');
  const params = { destination: ctx.destinationName };
  switch (kind) {
    case 'component-missing':
      return {
        title: interpolate(copy.bundleComponentMissing.title, {
          ...params,
          names: named((code) => !code.endsWith('GPSR_MISSING')),
        }),
        detail: copy.bundleComponentMissing.detail,
      };
    case 'component-gpsr-missing':
      return {
        title: interpolate(copy.bundleComponentGpsrMissing.title, {
          ...params,
          names: named((code) => code.endsWith('GPSR_MISSING')),
        }),
        detail: copy.bundleComponentGpsrMissing.detail,
      };
    case 'category-mismatch':
      return {
        title: interpolate(copy.bundleCategoryMismatch.title, params),
        detail: copy.bundleCategoryMismatch.detail,
      };
  }
}

/**
 * The chip for a blocker id. An id no descriptor knows (a plugin that is not
 * loaded, an id from an older build) keeps the fallback tone but carries its
 * raw id in the label, so the operator can still say WHICH check failed.
 */
export function chipFor(blocker: string, chips: Record<string, ChipDescriptor>): ChipDescriptor {
  return chips[blocker] ?? { ...FALLBACK_CHIP, label: `${FALLBACK_CHIP.label}: ${blocker}` };
}

/** Friendly label for a blocker key (see `chipFor` for an unknown id). */
export function blockerLabel(
  blocker: string,
  chips: Record<string, ChipDescriptor> = NEUTRAL_BLOCKER_CHIPS,
): string {
  return chipFor(blocker, chips).label;
}

export function isCategoryBlocker(blocker: string): boolean {
  return (
    blocker === 'no-match' ||
    blocker === 'multi-match' ||
    blocker === 'no-ean' ||
    blocker === 'invalid-barcode' ||
    blocker === 'unknown-category-result'
  );
}

/**
 * Whether the editor's `category not set` consequence chip applies (#3851).
 *
 * The cause half comes from the resolve-time blockers - a cause other than
 * `invalid-barcode` is only emitted where the destination does not resolve the
 * category at submit, so it is what makes the consequence true at all. The
 * category half must be LIVE: `liveCategoryId` is the category the editor would
 * submit right now (the same variant -> product -> resolved chain the submit
 * uses, #2240). Reading only the blockers kept the chip on screen after the
 * operator picked a category, asserting a problem that no longer existed.
 */
export function categoryNotSetApplies(
  blockers: readonly string[],
  liveCategoryId: string | null,
): boolean {
  if (liveCategoryId !== null && liveCategoryId.trim() !== '') return false;
  return blockers.some((b) => isCategoryBlocker(b) && b !== 'invalid-barcode');
}

/**
 * Collapse a row's blockers onto `invalid-barcode` as the single category cause
 * (#2240).
 *
 * A supplied-but-invalid barcode IS the cause, so it replaces the downstream
 * category cause rather than joining it: one cause chip per row keeps the Review
 * table readable, and `no catalog match` beside it would restate what the
 * operator's own typo already explains. `no-match` and `no-ean` are the two
 * outcomes a bad barcode produces upstream, and they are the two this drops.
 *
 * Lives here rather than at either call site because BOTH the Resolve step and
 * `recomputeVariantBlockers` apply it - the same policy expression written twice
 * is what `productCategoryIdOf` was extracted to stop one screen earlier.
 */
export function collapseToInvalidBarcode(blockers: readonly string[]): BulkRowBlocker[] {
  return [...blockers.filter((b) => b !== 'no-match' && b !== 'no-ean'), 'invalid-barcode'];
}

/**
 * The blockers that actually gate a row (#2243) - everything except the advisory
 * ones. One helper, because the same predicate decides the ready count, the
 * submit gate, the "only flagged" filter and the jump-to-next-flagged cursor;
 * four copies of it would drift the moment a fifth surface appears.
 */
export function gatingBlockers(
  blockers: readonly string[],
  chips: Record<string, ChipDescriptor>,
): readonly string[] {
  return blockers.filter((id) => chips[id]?.advisory !== true);
}

/**
 * Blockers that are a per-variant field editable in the variant scope panel
 * itself (so their fix CTA should stay on the variant, not jump to base).
 */
export function isVariantScopeFixable(blocker: string): boolean {
  return blocker === 'no-ean' || blocker === 'invalid-barcode';
}
