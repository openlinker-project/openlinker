/**
 * PrestaShop Pack Types + Availability Rule (#2598)
 *
 * A PrestaShop pack (`product_pack`) does not hold its sellable quantity in
 * `stock_available`: PrestaShop computes it from the pack's components at read
 * time. Selling a component therefore changes no stock row for the pack and
 * fires no hook, so a pack keeps selling after its components ran out. This
 * module holds the shapes the adapter reads off the product resource plus the
 * pure derivation rule, so the rule can be pinned by unit specs without HTTP.
 *
 * The concept stays inside the PrestaShop package on purpose: WooCommerce packs
 * have different semantics and Allegro has none, so a neutral pack model in
 * `libs/core` would cement one platform's shape.
 *
 * @module libs/integrations/prestashop/src/domain/types
 */

/**
 * `product.pack_stock_type` as PrestaShop stores it.
 *
 * `3` is a sentinel meaning "use the shop-wide `PS_PACK_STOCK_TYPE`". It must
 * be resolved shop-side before any derivation happens - passing it through
 * would make the pack behave like mode `0` (its own, permanently stale row) on
 * a shop configured to decrement components.
 */
export const PACK_STOCK_TYPE_SHOP_DEFAULT = 3;

/**
 * `0` defers to the shop default too, verified against PrestaShop 9.0.2
 * `classes/Pack.php`: `Pack::getQuantity` tests
 * `if (empty($packStockType) || $packStockType == self::STOCK_TYPE_DEFAULT)`,
 * and PHP's `empty(0)` is true. So a pack stored as `0` never means "pack only"
 * on its own - the shop setting decides, exactly as for the `3` sentinel.
 */
export function packStockTypeDefersToShop(rawStockType: number): boolean {
  return rawStockType === PACK_STOCK_TYPE_SHOP_DEFAULT || rawStockType === 0;
}

/**
 * How the pack's sellable quantity is decided.
 *
 * - `pack-only`   (PS `0`): the pack's own stock row is authoritative.
 * - `components`  (PS `1`): the quantity is implied by the components.
 * - `both`        (PS `2`): the lower of the two.
 */
export const PackStockModeValues = ['pack-only', 'components', 'both'] as const;
export type PackStockMode = (typeof PackStockModeValues)[number];

/** One entry of `associations.product_bundle` on a pack product. */
export interface PrestashopPackComponent {
  /** Component product id. */
  productId: string;
  /** Component combination id, or `null` when the component is a simple product. */
  combinationId: string | null;
  /** How many units of the component one pack consumes. Always `>= 1`. */
  quantity: number;
}

/** What a pack product declares about its own stock. */
export interface PrestashopPackDefinition {
  /** Raw `pack_stock_type`, still possibly the `3` sentinel. */
  rawStockType: number;
  components: PrestashopPackComponent[];
  /**
   * Bundle entries whose product id could not be read (#2627 review).
   *
   * A dropped entry is a dropped CONSTRAINT, and dropping a constraint from a
   * `min` always WIDENS the answer: a 3-component pack whose one unreadable
   * entry is out of stock would otherwise publish at the other two's 50 and
   * oversell. It is carried rather than discarded so `derivePackAvailability`
   * can treat it the same way it treats a component whose stock is unreadable -
   * as zero - instead of giving the same uncertainty the opposite reading.
   */
  unreadableComponentCount: number;
}

/** Available quantity of one component, keyed by {@link packComponentStockKey}. */
export type PackComponentAvailability = ReadonlyMap<string, number>;

/**
 * Key a component by the stock row that answers for it: PrestaShop keys stock
 * per `(id_product, id_product_attribute)`, and a bundle entry may name a
 * specific combination.
 */
export function packComponentStockKey(productId: string, combinationId: string | null): string {
  return `${productId}:${combinationId ?? '0'}`;
}

/**
 * Read a pack definition off a raw product resource, or `null` when the product
 * is not a pack.
 *
 * `cache_is_pack` is PrestaShop's own denormalised flag and is the only signal
 * available without a second read, so it - not the mere presence of a bundle
 * association - decides. An entry whose product id is unusable is dropped
 * rather than guessed at; see `derivePackAvailability` for what an empty
 * component list then means.
 */
export function readPackDefinition(product: unknown): PrestashopPackDefinition | null {
  if (product === null || typeof product !== 'object') {
    return null;
  }

  const raw = product as Record<string, unknown>;
  if (readNumber(raw.cache_is_pack) !== 1) {
    return null;
  }

  const associations =
    raw.associations !== null && typeof raw.associations === 'object'
      ? (raw.associations as Record<string, unknown>)
      : {};

  const components: PrestashopPackComponent[] = [];
  let unreadableComponentCount = 0;
  for (const entry of unwrapBundleEntries(associations.product_bundle)) {
    if (entry === null || typeof entry !== 'object') {
      unreadableComponentCount += 1;
      continue;
    }
    const row = entry as Record<string, unknown>;
    const productId = readId(row.id) ?? readId(row['@_id']) ?? readId(row.id_product);
    if (productId === null) {
      unreadableComponentCount += 1;
      continue;
    }
    const combinationId = readId(row.id_product_attribute);
    const declaredQuantity = readNumber(row.quantity);

    components.push({
      productId,
      // PrestaShop writes `0` for "the component as a whole"; that is the
      // aggregate row, not a combination.
      combinationId: combinationId === null || combinationId === '0' ? null : combinationId,
      // PrestaShop requires at least one unit per pack. An absent or
      // non-positive value is unusable rather than meaningful, and PrestaShop
      // itself has no answer for it: `Pack::getQuantity` divides by
      // `pack_quantity`, so on PHP 8 a stored `0` raises DivisionByZeroError and
      // the shop cannot report a quantity at all. Reading it as one unit errs
      // toward MORE availability than a strict reading would; the alternative,
      // zero, would zero every offer of a pack over one bad bundle row, and no
      // shop-side figure exists to prefer.
      quantity: declaredQuantity !== null && declaredQuantity > 0 ? Math.floor(declaredQuantity) : 1,
    });
  }

  return {
    rawStockType: readNumber(raw.pack_stock_type) ?? PACK_STOCK_TYPE_SHOP_DEFAULT,
    components,
    unreadableComponentCount,
  };
}

/**
 * Resolve `pack_stock_type` to a mode, substituting the shop default for the
 * `3` sentinel.
 *
 * An unresolvable shop default (config unreadable, or itself the sentinel)
 * falls back to `both`, which is the minimum of the two readings and so can
 * never report more than either. Guessing `pack-only` there would reinstate
 * exactly the overselling this rule exists to stop.
 *
 * Note that `0` on the product is not `pack-only` either - see
 * `packStockTypeDefersToShop`.
 */
export function resolvePackStockMode(
  rawStockType: number,
  shopDefault: number | null
): PackStockMode {
  const effective = packStockTypeDefersToShop(rawStockType) ? shopDefault : rawStockType;

  switch (effective) {
    case 0:
      return 'pack-only';
    case 1:
      return 'components';
    case 2:
      return 'both';
    default:
      return 'both';
  }
}

/**
 * How many packs the components allow, or `null` when the components cannot
 * answer.
 *
 * The rule mirrors PrestaShop's own `Pack::getQuantity`: the pack is limited by
 * its scarcest component, so the answer is
 * `min over components of floor(componentAvailable / unitsPerPack)`. Integer
 * division floors because half a component assembles no pack.
 *
 * A component with no known availability counts as zero, matching PrestaShop
 * (`StockAvailable::getQuantityAvailableByProduct` answers 0 for a missing
 * row): a component that cannot be found cannot be packed. `unreadableComponentCount`
 * gets the SAME reading rather than the opposite one (#2627 review): a bundle
 * entry `readPackDefinition` could not parse is still a constraint, and leaving
 * it out of the `min` widens the answer and oversells.
 *
 * `null` - not `0` - is returned for a pack with no components, because a
 * derivation with no inputs is not the shop reporting a sell-out. The caller
 * decides what to fall back to; reporting zero here would silently zero every
 * offer of a misconfigured pack.
 */
export function derivePackAvailability(
  components: readonly PrestashopPackComponent[],
  availability: PackComponentAvailability,
  unreadableComponentCount = 0
): number | null {
  if (components.length === 0) {
    return null;
  }

  // An entry that could not be read is a constraint we know exists and cannot
  // measure, and it is measured the same way an unmeasurable component's stock
  // is: as zero. The alternative - leaving it out of the `min` - widens the
  // answer on exactly the uncertainty that should narrow it, and oversells.
  if (unreadableComponentCount > 0) {
    return 0;
  }

  let limit = Number.POSITIVE_INFINITY;
  for (const component of components) {
    const available = availability.get(
      packComponentStockKey(component.productId, component.combinationId)
    );
    const packsFromComponent = Math.floor(Math.max(0, available ?? 0) / component.quantity);
    limit = Math.min(limit, packsFromComponent);
  }

  return limit;
}

/**
 * PrestaShop serialises an association either as a flat array (JSON) or as an
 * object holding the singular key (XML). Both reach the adapter depending on
 * the connection's response format.
 */
function unwrapBundleEntries(node: unknown): unknown[] {
  if (node === null || node === undefined) {
    return [];
  }
  if (Array.isArray(node)) {
    return node;
  }
  if (typeof node === 'object') {
    const inner = (node as Record<string, unknown>).product;
    if (inner === null || inner === undefined) {
      return [];
    }
    return Array.isArray(inner) ? inner : [inner];
  }
  return [];
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}
