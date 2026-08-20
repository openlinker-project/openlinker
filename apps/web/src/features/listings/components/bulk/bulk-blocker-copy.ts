/**
 * Bulk wizard blocker copy (#2240)
 *
 * One sentence pair per blocker id, so the Review table (chip tooltip) and the
 * variant editor (banner) cannot drift. Descriptors - label + tone - stay in
 * `bulk-blockers.ts`; the sentences live here because they need values the
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
 * @module apps/web/src/features/listings/components/bulk
 */
import { blockerLabel } from './bulk-blockers';

export interface BlockerCopyContext {
  /** The effective barcode for the row, or null when it has none. */
  ean: string | null;
  /** Resolved destination display name (plugin `platform.displayName`). */
  destinationName: string;
  /** How many variants a product-tier category fix would cover. */
  variantCount: number;
  /** Batch currency, for the currency-mismatch sentence. */
  batchCurrency: string;
}

export interface BlockerCopy {
  /** One sentence naming the cause and the offending value. */
  title: string;
  /** One sentence naming the consequence and/or the action. May be empty. */
  detail: string;
}

const quoted = (ean: string | null): string => (ean === null || ean === '' ? 'this barcode' : ean);

/**
 * Copy for one blocker id. Unknown ids (platform-contributed, e.g.
 * `allegro:title-too-long`) fall back to their chip label plus a generic
 * instruction, which is what the pre-#2240 banner did for every blocker.
 */
export function describeBlocker(blocker: string, ctx: BlockerCopyContext): BlockerCopy {
  const all = `all ${ctx.variantCount} variants`;
  switch (blocker) {
    case 'no-match':
      return {
        title: `Barcode ${quoted(ctx.ean)} isn't in the ${ctx.destinationName} catalog, and no category mapping covers this product.`,
        // Deliberately does NOT offer "or just for this variant" as an
        // alternative: the editor's own save requires a category on the product,
        // so a per-variant override alone cannot be saved. The override is a
        // refinement of the shared value, and the editor offers it only once
        // that value exists (#2240).
        detail: `No category was detected, so this variant can't be listed yet. Set one for ${all}.`,
      };
    case 'invalid-barcode':
      return {
        title: `${quoted(ctx.ean)} isn't a valid barcode.`,
        detail:
          "The last digit is a check digit and it doesn't match. Correct it in this variant's fields below.",
      };
    case 'no-ean':
      return {
        title: 'This variant has no barcode.',
        detail: `Add one below so ${ctx.destinationName} can match a category, or pick a category now.`,
      };
    case 'multi-match':
      return {
        title: `Several ${ctx.destinationName} catalog products share barcode ${quoted(ctx.ean)}.`,
        detail: 'Pick the category to list under.',
      };
    case 'unknown-category-result':
      return {
        title: `${ctx.destinationName} returned a category result this version doesn't recognise.`,
        detail:
          'Pick a category to continue. The lookup was not empty - its answer was not understood, so nothing was ruled out.',
      };
    case 'no-master-price':
      return {
        title: 'This variant has no price in the master catalog.',
        detail: 'Set a price for it below, or switch it off to skip it.',
      };
    case 'no-master-stock':
      return {
        title: 'This variant has no stock in the master catalog.',
        detail: 'Set a stock value below, or switch it off to skip it.',
      };
    case 'currency-mismatch':
      return {
        title: `The master price is not in ${ctx.batchCurrency}.`,
        detail: `Set an explicit ${ctx.batchCurrency} price for this variant, or change the batch currency.`,
      };
    case 'no-variant':
      return {
        title: 'This product has no variants.',
        detail: 'It cannot be listed until the master catalog reports at least one.',
      };
    default:
      return {
        title: `${blockerLabel(blocker)}.`,
        detail: 'Resolve this blocker for the variant, or switch the variant off to skip it.',
      };
  }
}
