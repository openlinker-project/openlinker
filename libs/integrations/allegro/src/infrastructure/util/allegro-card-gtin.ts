/**
 * Allegro Card GTIN
 *
 * Allegro reports a catalogue card's EAN inside `parameters[]`, under the entry
 * flagged `options.isGTIN === true`, and NOT as a top-level `ean` field. The
 * live sandbox response for `GET /sale/products?mode=GTIN` carries no top-level
 * `ean` at all, so any filter reading `card.ean` alone never matches. One reader
 * for both the batch category matcher and the smart-link card resolver keeps the
 * two from drifting.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type { AllegroProductCardSummary } from '../../domain/types/allegro-api.types';

/**
 * True when the card carries an EAN-bearing parameter (`options.isGTIN === true`)
 * whose value matches `ean` exactly. Defensive against Allegro's fuzzy matcher:
 * even with `mode=GTIN` the result is re-filtered on the parameter.
 */
export function hasExactGtin(card: AllegroProductCardSummary, ean: string): boolean {
  if (!Array.isArray(card.parameters)) return false;
  for (const param of card.parameters) {
    if (param.options?.isGTIN !== true) continue;
    if (Array.isArray(param.values) && param.values.some((v) => v === ean)) {
      return true;
    }
  }
  return false;
}
