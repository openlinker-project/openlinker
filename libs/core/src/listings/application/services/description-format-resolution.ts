/**
 * Description Format Resolution
 *
 * Resolves a destination's declared `DescriptionFormat` off an adapter the
 * caller already holds, and applies it to the two shapes a description travels
 * in - a bare string (offer create, shop publish) and the sectioned tree
 * (`updateOfferFields`).
 *
 * Every path handing a description to a destination applies the format
 * (ADR-046). This module exists so that rule has ONE implementation rather than
 * four copies: there are four such paths today, and the count has already been
 * wrong twice while writing this epic.
 *
 * ## Why the resolution is defensive
 *
 * `getDescriptionFormat()` is a required member of `OfferFieldUpdater` and
 * `ShopProductManagerPort`, so the compiler covers every in-tree adapter. It
 * does not cover an out-of-tree plugin compiled against an older `libs/core`,
 * which would satisfy `isOfferFieldUpdater` (the guard tests only
 * `updateOfferFields`) and then throw on a missing method at publish time.
 * Widening the guard instead would silently stop recognising such a plugin for
 * field updates - a worse failure for a legitimate adapter. So the resolver
 * probes for the method and falls back to `CONSERVATIVE_DESCRIPTION_FORMAT`,
 * which is what that fallback is for.
 *
 * @module libs/core/src/listings/application/services
 */
import { applyDescriptionFormat } from './apply-description-format';
import {
  CONSERVATIVE_DESCRIPTION_FORMAT,
  type DescriptionFormat,
} from '../../domain/types/description-format.types';
import type { OfferFieldUpdate } from '../../domain/types/offer-update.types';
import type { OfferManagerPort } from '../../domain/ports/offer-manager.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';

interface DescriptionFormatDeclaring {
  getDescriptionFormat(): DescriptionFormat;
}

function declares(adapter: unknown): adapter is DescriptionFormatDeclaring {
  return (
    typeof (adapter as Partial<DescriptionFormatDeclaring>).getDescriptionFormat === 'function'
  );
}

/**
 * The format a marketplace destination declares. Narrow the adapter you already
 * resolved - never resolve a second one for this.
 */
export function resolveOfferDescriptionFormat(adapter: OfferManagerPort): DescriptionFormat {
  return declares(adapter) ? adapter.getDescriptionFormat() : CONSERVATIVE_DESCRIPTION_FORMAT;
}

/** The format a shop destination declares. Required on the port, so always present in-tree. */
export function resolveShopDescriptionFormat(
  adapter: ShopProductManagerPort,
): DescriptionFormat {
  return declares(adapter) ? adapter.getDescriptionFormat() : CONSERVATIVE_DESCRIPTION_FORMAT;
}

/**
 * Shape a description string for its destination, returning `undefined` when
 * nothing survives.
 *
 * `undefined` rather than `''` is deliberate: every call site treats an absent
 * description as "do not send this field", which is the semantics the Allegro
 * adapter used to implement locally with a `.trim().length > 0` check before it
 * stopped sanitizing. Returning `''` would ship an empty description instead of
 * omitting the field.
 */
export function formatDescriptionForDestination(
  description: string | null | undefined,
  format: DescriptionFormat,
): string | undefined {
  if (description == null || description === '') return undefined;
  const shaped = applyDescriptionFormat(description, format);
  return shaped === '' ? undefined : shaped;
}

/**
 * Apply the format to every TEXT item of a sectioned description update,
 * dropping items the pass empties and then sections left with no items.
 *
 * Non-description fields pass through untouched - this is not a general
 * sanitiser, it is the description contract.
 */
export function formatOfferFieldsForDestination(
  fields: OfferFieldUpdate,
  format: DescriptionFormat,
): OfferFieldUpdate {
  if (fields.description === undefined) return fields;

  const sections = fields.description.sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => ({ ...item, content: applyDescriptionFormat(item.content, format) }))
        .filter((item) => item.content !== ''),
    }))
    .filter((section) => section.items.length > 0);

  if (sections.length === 0) {
    // Nothing survived: omit the field rather than sending an empty tree, so a
    // destination never interprets it as "clear the description".
    const rest = { ...fields };
    delete rest.description;
    return rest;
  }

  return { ...fields, description: { ...fields.description, sections } };
}
