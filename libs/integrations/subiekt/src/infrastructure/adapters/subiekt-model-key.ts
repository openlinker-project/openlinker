/**
 * Subiekt model product key + variant label
 *
 * Two pure functions and a prefix, kept out of the adapter so both are
 * testable on their own and so the key format has exactly one definition.
 *
 * A Subiekt MODEL (`sl_ModelTw`) becomes an OpenLinker Product; the towary in
 * it become its ProductVariants. A product that stands for a model therefore
 * needs an external id that is NOT any member's symbol - picking one member's
 * symbol would make the product's identity move the day an operator removes
 * that towar from the model.
 *
 * @module libs/integrations/subiekt/src/infrastructure/adapters
 */

/**
 * Namespace for a model-keyed product external id.
 *
 * A towar symbol cannot collide with it: Subiekt's own symbol field rejects
 * `:` (it is a short code, not free text), and even if one slipped through,
 * `modelIdFromProductKey` only accepts a strictly-positive integer after the
 * prefix, so `model:abc` reads as an ordinary symbol rather than as a model.
 */
export const MODEL_PRODUCT_KEY_PREFIX = 'model:';

/** `1` -> `'model:1'`. */
export function modelProductKey(modelId: number): string {
  return `${MODEL_PRODUCT_KEY_PREFIX}${modelId}`;
}

/**
 * `'model:1'` -> `1`; anything else -> `null`.
 *
 * Strict on purpose. A malformed value (`model:`, `model:0`, `model:-3`,
 * `model:1.5`, `model:1x`) reads as NOT a model key rather than as model
 * `NaN`: the caller then treats it as a towar symbol and gets an honest 404
 * from the bridge, instead of requesting `/api/models/NaN`.
 */
export function modelIdFromProductKey(externalId: string): number | null {
  if (!externalId.startsWith(MODEL_PRODUCT_KEY_PREFIX)) return null;
  const raw = externalId.slice(MODEL_PRODUCT_KEY_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  return Number(raw);
}

/**
 * The value that distinguishes one member of a model from its siblings.
 *
 * Subiekt carries NO variant axis: `sl_ModelTw` is `(mdt_Id, mdt_Nazwa)` and
 * `sl_ModelTowar` is `(mtw_Id, mtw_IdModel, mtw_IdTowar)` - there is no
 * per-member attribute value anywhere, and the `sl_WlasciwCechTw` /
 * `sl_WlasciwoscCecha` property tables are empty on the reference install.
 * The only thing that tells "100ml" from "50ml" is the tail of `tw_Nazwa`.
 *
 * So the label is the member's name with the model's name stripped from the
 * front, and the member's FULL name when it does not start with the model's -
 * never an empty string, and never a guess assembled from anything else. A
 * label is required rather than optional because `OfferBuilderService` builds
 * a listing's variant group from `ProductVariant.attributes`: siblings that
 * all carried the same (or no) attributes would be indistinguishable to an
 * explicit-grouping destination.
 *
 * Deriving here rather than in the bridge is deliberate - this is a decision
 * about OpenLinker's neutral `ProductVariant` shape, and the bridge reports
 * the two raw names without interpreting either.
 */
export function deriveVariantLabel(modelName: string, towarName: string): string {
  const model = modelName.trim();
  const towar = towarName.trim();
  if (model.length > 0 && towar.toLowerCase().startsWith(model.toLowerCase())) {
    const tail = towar.slice(model.length).trim();
    if (tail.length > 0) return tail;
  }
  return towar;
}
