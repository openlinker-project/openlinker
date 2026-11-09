/**
 * Assign Packing Work composed labels (#3340, i18n #3875)
 *
 * The two board sentences built from parts, read from
 * `fulfillment.assignPackingWork` at call time so they follow the active
 * language.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { formatPlural, getLocale, getMessages, interpolate } from '../../../shared/i18n';

/**
 * What the packer will scan (#3096). The unit count is said only when it
 * differs from the product count - "1 product, 1 unit" says the same thing
 * twice.
 */
export function formatScanSummary(parts: { readonly lines: number; readonly units: number }): string {
  const copy = getMessages('fulfillment').assignPackingWork.card.summary;
  const locale = getLocale();
  const products = formatPlural(parts.lines, copy.products, locale);
  if (parts.units === parts.lines) return interpolate(copy.productsToScan, { products });
  return interpolate(copy.productsAndUnitsToScan, {
    products,
    units: formatPlural(parts.units, copy.units, locale),
  });
}

/**
 * #3424 - a packer lane's station plus live presence, e.g. "Bench 3 · online".
 * A packer with no `stationLabel` gets presence alone rather than an empty
 * line; offline says so explicitly, because a blank line reads as "no signal".
 */
export function formatPackerSubtitle(packer: {
  readonly online: boolean;
  readonly stationLabel: string | null;
}): string {
  const copy = getMessages('fulfillment').assignPackingWork.lane.packerSubtitle;
  const presence = packer.online ? copy.online : copy.offline;
  return packer.stationLabel === null
    ? presence
    : interpolate(copy.withStation, { station: packer.stationLabel, presence });
}
