/**
 * Erli Buyable-Problem Mapper
 *
 * Turns Erli's `ProductResponse.buyableProblems` codes into neutral
 * `CreateOfferValidationError` entries an operator can act on (#2231).
 *
 * Erli answers WHY an offer cannot be bought with an 18-value enum. A raw enum
 * member is not an answer for a seller - `missingTaxRate` on a listings row is
 * an internal token - so the sentences live here, adapter-side, next to the only
 * code that knows what the values mean. Core receives sentences plus the raw
 * code, and never learns an Erli string.
 *
 * Three rules the copy follows, and they are load-bearing rather than stylistic:
 *
 * - **Never the word "rejected".** Erli has no rejection status; an offer is
 *   active or inactive, with or without listed problems. Calling it rejected
 *   puts words in the marketplace's mouth.
 * - **Never promise it will clear itself,** except for the three shop-level
 *   reasons, which genuinely do once the shop is in order.
 * - **An unrecognised code is surfaced, not swallowed.** Erli can add a value
 *   before OL has a sentence for it, and a code the operator can search beats
 *   silence.
 *
 * `scope` is the seam that keeps the shop-level reasons off the rows: they
 * describe the SHOP, so when one is live Erli reports it against every offer,
 * and rendering it per row stamps one sentence on every row while burying the
 * single fact worth acting on. The adapter declares `'account'` for the two that
 * are unambiguously about the shop (`shop-activity`, `shopKyc`); core splits on
 * that neutral field. `blocked` stays offer-scoped - see the note at its entry.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 * @see {@link ErliBuyableProblemValues} for the enum, verbatim from the swagger
 */
import type { CreateOfferValidationError, OfferValidationScope } from '@openlinker/core/listings';
import { ErliBuyableProblemValues, type ErliBuyableProblem } from './erli-product.types';

interface ErliBuyableProblemCopy {
  /** One short line - all the `/listings` row has room for. */
  summary: string;
  /** The full sentence: what is wrong, and what to change. */
  message: string;
  scope: OfferValidationScope;
  /**
   * Render order. Lower first, so the row's single line carries the most
   * consequential problem rather than whichever one Erli happened to list
   * first. Every Erli problem blocks buyability, so this ranks by how directly
   * it does: a missing price or tax rate stops the sale outright, a market or
   * translation gap stops it on one market, and a deliberate switch-off is the
   * one the seller most likely already knows about.
   */
  priority: number;
}

/**
 * Every value of Erli's enum, exhaustively - `Record` over the union, so an
 * enum member added to `ErliBuyableProblemValues` fails to compile here rather
 * than silently rendering a raw code to a seller.
 */
const ERLI_BUYABLE_PROBLEM_COPY: Record<ErliBuyableProblem, ErliBuyableProblemCopy> = {
  missingPrice: {
    summary: 'No price set on Erli',
    message: 'The offer has no price. Set one on the product and publish again.',
    scope: 'offer',
    priority: 10,
  },
  minPrice: {
    summary: "Price below Erli's minimum",
    message: 'Erli rejects this price as too low for the category. Raise it and publish again.',
    scope: 'offer',
    priority: 11,
  },
  maxPrice: {
    summary: "Price above Erli's maximum",
    message: 'Erli rejects this price as too high for the category. Lower it and publish again.',
    scope: 'offer',
    priority: 12,
  },
  missingTaxRate: {
    summary: 'No VAT rate set on Erli',
    message:
      'Erli needs a tax rate before the offer can be sold. Set it on the product and publish again.',
    scope: 'offer',
    priority: 13,
  },
  stock: {
    summary: 'Out of stock on Erli',
    message:
      "The channel reports no available quantity. Check the master stock and the connection's stock buffer.",
    scope: 'offer',
    priority: 20,
  },
  delivery: {
    summary: 'No delivery price list assigned',
    message:
      "Pick a delivery price list in the offer's settings, or set a default for the connection.",
    scope: 'offer',
    priority: 21,
  },
  category: {
    summary: 'Category missing or not accepted',
    message:
      "Erli did not accept the category sent with this offer. Map the product's category for this connection and publish again.",
    scope: 'offer',
    priority: 22,
  },
  image: {
    summary: 'No usable product image',
    message:
      'Erli could not use any of the images sent. Check that the product has at least one reachable image URL.',
    scope: 'offer',
    priority: 23,
  },
  name: {
    summary: 'Product name rejected',
    message:
      'Erli rejected the title, usually for length or forbidden wording. Edit the name and publish again.',
    scope: 'offer',
    priority: 24,
  },
  condition: {
    summary: 'Product condition not set',
    message:
      'Erli needs to know whether this is new or used. Set the condition on the product and publish again.',
    scope: 'offer',
    priority: 25,
  },
  terms: {
    summary: 'Warranty or returns terms missing',
    message:
      'Erli requires warranty, guarantee and returns terms. Set them for this offer or as shop defaults in the Erli panel.',
    scope: 'offer',
    priority: 26,
  },
  translations: {
    summary: 'Translation missing for a market',
    message:
      'The offer is listed on a market it has no translation for. Add the translation or drop that market.',
    scope: 'offer',
    priority: 30,
  },
  marketInactive: {
    summary: 'Market turned off for this offer',
    message:
      'The market this offer targets is not active for it. Enable the market or list on an active one.',
    scope: 'offer',
    priority: 31,
  },
  archived: {
    summary: 'Archived on Erli',
    message:
      'Archived offers cannot be bought and disappear from the seller panel. Unarchive it in Erli to sell it again.',
    scope: 'offer',
    priority: 40,
  },
  active: {
    summary: 'Set to inactive on Erli',
    message:
      'The offer is switched off on the channel. If that was not deliberate, publish again to reactivate it.',
    scope: 'offer',
    priority: 41,
  },
  // ── Shop-level. Not the offer's fault, and reported on every offer. ──
  'shop-activity': {
    summary: 'Shop is not active on Erli',
    message: 'Every listing on this connection is blocked until the shop is active again.',
    scope: 'account',
    priority: 1,
  },
  shopKyc: {
    summary: 'Shop verification incomplete',
    message: 'Finish verification in the Erli seller panel; the next status read clears it.',
    scope: 'account',
    priority: 2,
  },
  // `blocked` is the one code whose own wording admits it may be per-offer, so
  // it is scoped to the OFFER despite sitting with the shop-level reasons.
  // Scoping it `account` pulls it off the row entirely and into a
  // once-per-connection banner, which makes a genuinely offer-level block
  // invisible on the offer it blocks - the loss this seam exists to prevent, in
  // the other direction. Over-reporting is the recoverable arm: if the block
  // really is shop-wide, Erli reports it on every offer and the operator sees a
  // repeated line, which is noisy and true.
  blocked: {
    summary: 'Blocked by Erli',
    message:
      'Erli has blocked this shop or offer. Contact Erli support; OpenLinker cannot clear this.',
    scope: 'offer',
    priority: 3,
  },
};

/** Unrecognised codes sort after everything OL has a sentence for. */
const UNKNOWN_PROBLEM_PRIORITY = 90;

const ERLI_BUYABLE_PROBLEMS = new Set<string>(ErliBuyableProblemValues);

function isErliBuyableProblem(code: string): code is ErliBuyableProblem {
  return ERLI_BUYABLE_PROBLEMS.has(code);
}

/**
 * Map Erli's `buyableProblems` onto neutral validation errors, ordered so the
 * first entry is the one a single-line surface should show.
 *
 * Non-string and blank entries are dropped (this is untyped wire JSON), and
 * duplicates are collapsed - Erli reporting the same code twice must not double
 * a row's overflow count. An unrecognised code is emitted with its raw value in
 * the copy, so the operator has something to search for and OL never pretends
 * to know what it means.
 */
export function mapErliBuyableProblems(
  buyableProblems: readonly unknown[] | undefined,
): CreateOfferValidationError[] {
  if (!Array.isArray(buyableProblems)) {
    return [];
  }
  const seen = new Set<string>();
  const ranked: { error: CreateOfferValidationError; priority: number }[] = [];
  for (const raw of buyableProblems) {
    if (typeof raw !== 'string') continue;
    const code = raw.trim();
    if (code.length === 0 || seen.has(code)) continue;
    seen.add(code);
    if (isErliBuyableProblem(code)) {
      const copy = ERLI_BUYABLE_PROBLEM_COPY[code];
      ranked.push({
        error: { code, summary: copy.summary, message: copy.message, scope: copy.scope },
        priority: copy.priority,
      });
      continue;
    }
    ranked.push({
      error: {
        code,
        summary: `Erli reported a problem OpenLinker does not recognise (${code})`,
        message: `Erli reported "${code}" as a reason this offer cannot be bought. OpenLinker has no description for it yet - check it against Erli's documentation or the Erli seller panel.`,
        scope: 'offer',
      },
      priority: UNKNOWN_PROBLEM_PRIORITY,
    });
  }
  // Stable within a priority: `Array.prototype.sort` is stable in every runtime
  // this ships on, so two problems that rank equally keep Erli's own order.
  return ranked.sort((a, b) => a.priority - b.priority).map((entry) => entry.error);
}
