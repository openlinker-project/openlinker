/**
 * Shoper Sellable Stocks Policy
 *
 * Which `product-stocks` rows of a product are VARIANTS a buyer can be sold,
 * shared by the `ProductMaster` (variants) and the `InventoryMaster` (stock
 * levels) so the two always agree on what a variant is.
 *
 * Every Shoper product has a base stock (`extended: "0"`, options `[]`). A
 * product with variants additionally carries one extended stock
 * (`extended: "1"`) per option combination, and the shop then makes the buyer
 * choose one: the base row of such a product is the template the variants
 * inherit from, not an item anyone can order. Listing it would create a
 * marketplace offer for a variant that does not exist (verified live on product
 * 161: base stock 264 next to four colour stocks) and count the product's stock
 * twice (live: S 5 + M 5 + L 5 reported as 30).
 *
 * So: when ANY row is a variant row, only those rows are variants and the base
 * row is kept aside, because variant prices and weights are stated relative to
 * it (`price_type` / `weight_type`). A product with no variant row keeps its
 * base stock as its single variant.
 *
 * A row is a variant row when it says so through `extended`. A row that does
 * not report `extended` falls back to its options: any option, even a
 * malformed one, makes it a variant row (dropping it would hide a real
 * variant); no options at all makes it a base row. Rows that report neither
 * read as base rows, so the rule then degrades to "every row is a variant",
 * never to dropping one.
 *
 * Upgrade consequence, deliberate: on an install that synced a variant
 * product before this rule existed, its base row was already a
 * `ProductVariant`. The next master sync no longer reports it, the variant
 * prune marks it stale, and the stale-variant chain (#1689) pauses - zeroes
 * the quantity of - any marketplace offer listed against it, with no operator
 * action. That offer sold an item that does not exist, so pausing it is the
 * right outcome; the remediation is to list the product again per colour/size
 * variant. The package README carries the same upgrade note.
 *
 * @module libs/integrations/shoper/src/domain/policies
 */
import type { ShoperStock } from '../types/shoper-api.types';

type StockShape = Pick<ShoperStock, 'extended'> &
  Partial<Pick<ShoperStock, 'options' | 'default'>>;

/** Whether a stock row is a variant stock (`extended`, `"1"` on the wire). */
export function isExtendedShoperStock(stock: Pick<ShoperStock, 'extended'>): boolean {
  return stock.extended === '1' || stock.extended === 1;
}

function reportsExtended(stock: Pick<ShoperStock, 'extended'>): boolean {
  return stock.extended !== null && stock.extended !== undefined && String(stock.extended) !== '';
}

function hasNoOptions(options: unknown): boolean {
  if (options === null || options === undefined) {
    return true;
  }
  if (Array.isArray(options)) {
    return options.length === 0;
  }
  return typeof options === 'object' && Object.keys(options).length === 0;
}

function isVariantRow(stock: StockShape): boolean {
  return reportsExtended(stock) ? isExtendedShoperStock(stock) : !hasNoOptions(stock.options);
}

/** A product's stock rows split into what is sold and the row it is derived from. */
export interface ShoperStockPartition<T> {
  readonly variants: readonly T[];
  /** The base row of a product that has variant rows; `null` when the base row IS the variant. */
  readonly base: T | null;
}

/** The rows of ONE product split into its sellable variants and, for a product with variants, its base row. */
export function partitionSellableShoperStocks<T extends StockShape>(
  stocks: readonly T[],
): ShoperStockPartition<T> {
  const variants = stocks.filter(isVariantRow);
  if (variants.length === 0) {
    return { variants: [...stocks], base: null };
  }
  const baseRows = stocks.filter((stock) => !isVariantRow(stock));
  const base = baseRows.find((stock) => String(stock.default) === '1') ?? baseRows[0] ?? null;
  return { variants, base };
}

/** The rows of ONE product that are sellable variants, in their original order. */
export function selectSellableShoperStocks<T extends StockShape>(stocks: readonly T[]): T[] {
  return [...partitionSellableShoperStocks(stocks).variants];
}
