/**
 * Routed parcel profile (#3652)
 *
 * Reads the default parcel a routing rule carries for an order's delivery
 * method, in the units the dispatch forms hold (mm / g, template code). Absent
 * or empty profile -> null, so callers keep today's behaviour untouched.
 *
 * @module apps/web/src/features/orders/lib
 */
import { hasParcelProfile, type ParcelProfileFields, type RoutingRule } from '../../mappings';

export interface RoutedParcelPrefill {
  template?: string;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  weightGrams?: number;
}

export function findRuleForMethod(
  rules: readonly RoutingRule[] | undefined,
  deliveryMethodId: string | undefined,
): RoutingRule | undefined {
  if (!deliveryMethodId) return undefined;
  return (rules ?? []).find((r) => r.sourceDeliveryMethodId === deliveryMethodId);
}

export function parcelPrefillFromFields(
  fields: ParcelProfileFields | null | undefined,
): RoutedParcelPrefill | null {
  if (!fields || !hasParcelProfile(fields)) return null;
  const out: RoutedParcelPrefill = {};
  if (fields.parcelTemplate) out.template = fields.parcelTemplate;
  if (fields.lengthMm != null) out.lengthMm = fields.lengthMm;
  if (fields.widthMm != null) out.widthMm = fields.widthMm;
  if (fields.heightMm != null) out.heightMm = fields.heightMm;
  if (fields.defaultWeightGrams != null) out.weightGrams = fields.defaultWeightGrams;
  return out;
}

export function parcelPrefillForMethod(
  rules: readonly RoutingRule[] | undefined,
  deliveryMethodId: string | undefined,
): RoutedParcelPrefill | null {
  return parcelPrefillFromFields(findRuleForMethod(rules, deliveryMethodId));
}

/** Parcel inputs as the bulk dialog holds them (strings, mm / g). */
export interface ParcelFieldStrings {
  length: string;
  width: string;
  height: string;
  weightGrams: string;
}

/**
 * Fills the blanks of a dialog-wide default box from a routed profile. A value
 * the operator typed always wins; the routed profile only supplies what is empty.
 */
export function mergeParcelWithRoutedPrefill(
  base: ParcelFieldStrings,
  routed: RoutedParcelPrefill | null,
): ParcelFieldStrings {
  if (!routed) return base;
  const pick = (typed: string, fromRule: number | undefined): string =>
    typed.trim() !== '' || fromRule === undefined ? typed : String(fromRule);
  return {
    length: pick(base.length, routed.lengthMm),
    width: pick(base.width, routed.widthMm),
    height: pick(base.height, routed.heightMm),
    weightGrams: pick(base.weightGrams, routed.weightGrams),
  };
}
