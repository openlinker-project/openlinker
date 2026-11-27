/**
 * Allegro pack-quantity mapper (#3929)
 *
 * Reads how many units of product one SOLD unit of an offer contains, from the
 * checkout form's `lineItems[].offer.productSet`. The line's own `quantity`
 * counts offers sold, so the per-set count is the whole answer; the two are
 * multiplied downstream, never here.
 *
 * @module libs/integrations/allegro/src/infrastructure/adapters
 */
import type { AllegroCheckoutForm } from '../../domain/types/allegro-api.types';

type AllegroLineProductSet = AllegroCheckoutForm['lineItems'][number]['offer']['productSet'];

/**
 * Returns the units per sold unit when the set is ONE product repeated (all
 * entries share an `id`, quantities summed) and the total is above one,
 * otherwise `undefined`. A set of two or more DIFFERENT products is a bundle,
 * not a multipack, and is left to the bundle definition of the mapped variant
 * (#3607). Absent, empty, malformed and exactly-one sets read as an ordinary
 * line, so a payload this mapper does not understand never holds an order that
 * core would have accepted.
 */
export function toPackQuantity(productSet: AllegroLineProductSet): number | undefined {
  const products = productSet?.products;
  if (!Array.isArray(products) || products.length === 0) return undefined;
  let total = 0;
  let firstId: string | undefined;
  for (const [index, product] of products.entries()) {
    const quantity = product?.quantity;
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      return undefined;
    }
    // An entry with no usable id cannot be shown to be the same product as the
    // others, so the set is not read as a multipack.
    if (typeof product.id !== 'string' || product.id.length === 0) {
      return undefined;
    }
    if (index === 0) {
      firstId = product.id;
    } else if (product.id !== firstId) {
      return undefined;
    }
    total += quantity;
  }
  return total > 1 ? total : undefined;
}
