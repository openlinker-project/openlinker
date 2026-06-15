/**
 * Offer Parameter Type
 *
 * Neutral, section-tagged marketplace offer/category parameter — the canonical
 * domain shape that travels on `CreateOfferCommand.parameters` (#1039, ADR-023
 * §3 / ADR-024 §Flow). Produced by core (attribute projection + operator
 * picks); shaped to platform wire **only** in the destination adapter (Allegro
 * splits by `section` into `body.parameters[]` vs `productSet[].product
 * .parameters[]`; a borrows/open destination maps it to its own param shape).
 *
 * Modelled in the domain (not carried through the opaque `platformParams` bag)
 * so `CreateOfferCommand` can reference it without a domain→application edge —
 * the application-layer `ResolvedParameter` is an alias of this type.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link CategoryParameterSection} for the offer/product axis
 */

import type { CategoryParameterSection } from './category-parameter.types';

export interface OfferParameter {
  /**
   * Destination parameter identifier. On the **owns** path this is the live
   * `CategoryParameter.id`; on the **borrows/open** pass-through path it is the
   * destination parameter name the adapter interprets.
   */
  id: string;
  /** Free-text / pass-through values. */
  values?: string[];
  /** Resolved dictionary entry ids (owns path + dictionary-typed parameter). */
  valuesIds?: string[];
  /**
   * Numeric-range value (integer/float range parameters, e.g. Allegro "weight
   * from–to"). Operator-supplied only — attribute projection never produces a
   * range. Mutually exclusive with `values`/`valuesIds` in practice.
   */
  rangeValue?: { from: string; to: string };
  /** Neutral offer/product axis; the adapter buckets the wire payload on it. */
  section: CategoryParameterSection;
}
