/**
 * Order Search Text (#3527)
 *
 * Pure derivation of the denormalized `order_records.searchText` column: order
 * number, buyer name, buyer email and every line SKU, space-joined and
 * diacritic-folded — the `DestinationCategory.searchText` precedent
 * (`normalizeCategorySearchText`,
 * `libs/core/src/listings/domain/destination-category-search.ts`).
 *
 * Duplicated here rather than imported: `orders` does not depend on `listings`
 * (`docs/architecture-overview.md § Cross-context dependencies in core`), and
 * a ~20-line pure normalizer is cheaper to keep in two places than to open a
 * cross-context edge for.
 *
 * Reads defensively off `Record<string, unknown>` because `OrderRecord.
 * orderSnapshot` holds EITHER a raw `IncomingOrder` (`recordStatus:
 * 'awaiting_mapping'`) or a resolved `Order` (`recordStatus: 'ready'`) — both
 * carry the same field names this function reads (`orderNumber`,
 * `customerEmail`, `billingAddress`/`shippingAddress.{firstName,lastName}`,
 * `items[].sku`), so there is no need to discriminate between the two shapes.
 *
 * ## PII (#3507 G03-14)
 *
 * `storePii` is an explicit argument, never an environment read, so this
 * module stays pure (the `buildRoutingShipTo` precedent,
 * `libs/core/src/fulfillment/domain/types/routing-ship-to.types.ts`). With it
 * `false` the corpus is the order number and the line SKUs ONLY — no email, no
 * names — regardless of what the snapshot carries.
 *
 * The snapshot alone cannot be trusted to answer that question. An order
 * ingested while `OL_STORE_PII` was on keeps the buyer's real name and email
 * in its stored `orderSnapshot` after the flag is turned off (the flip is not
 * retroactive — `order-export-columns.ts` blanks its PII columns
 * unconditionally for the same reason), so deriving from "whatever the
 * snapshot happens to carry" left those rows searchable by surname on an
 * install that promises not to store personal data. The worker's
 * `OrderSearchTextReindexService` pass re-derives existing rows under the
 * current flag; every new write goes through this function with it.
 *
 * @module libs/core/src/orders/domain
 */

/**
 * The install's PII mode, resolved by the caller (`getEnvBoolean('OL_STORE_PII',
 * true)` — see `OrderRecordRepository.toOrm` for why not `getPiiConfig()`).
 */
export interface OrderSearchTextOptions {
  readonly storePii: boolean;
}

/**
 * Letters NFD does NOT decompose — see `normalizeCategorySearchText`'s
 * docblock for the full rationale (the `ł` / `Artykuły` trap). Must stay
 * identical to that table — `scripts/check-non-decomposing-letters-mirror.mjs`
 * fails `pnpm lint` when the two drift.
 */
const NON_DECOMPOSING_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ø/g, 'o'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
];

/**
 * Lowercase, fold diacritics, collapse whitespace. BOTH the write path (this
 * module's {@link deriveOrderSearchText}) and the read path (the repository's
 * `search` query) call this same function, so the stored column and an
 * incoming query can never drift apart.
 */
export function normalizeOrderSearchText(value: string): string {
  let normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  for (const [pattern, replacement] of NON_DECOMPOSING_LETTERS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.trim().replace(/\s+/g, ' ');
}

/** Narrow an unknown snapshot address into its first/last name, if present. */
function readAddressName(value: unknown): string[] {
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const raw = value as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof raw.firstName === 'string' && raw.firstName.length > 0) {
    parts.push(raw.firstName);
  }
  if (typeof raw.lastName === 'string' && raw.lastName.length > 0) {
    parts.push(raw.lastName);
  }
  return parts;
}

/** Narrow an unknown snapshot `items` array into its non-empty SKUs. */
function readItemSkus(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const skus: string[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const sku = (item as Record<string, unknown>).sku;
    if (typeof sku === 'string' && sku.length > 0) {
      skus.push(sku);
    }
  }
  return skus;
}

/**
 * Build the raw (pre-normalization) search corpus for one order snapshot.
 * Exported separately from {@link deriveOrderSearchText} so a caller matching
 * against a *typed* `Order`/`IncomingOrder` (rather than the raw jsonb) can
 * still normalize identically — none exists today, but the corpus and the
 * normalization are two independent concerns and should stay two functions.
 */
export function buildOrderSearchCorpus(
  snapshot: Record<string, unknown>,
  options: OrderSearchTextOptions
): string {
  const parts: string[] = [];

  if (typeof snapshot.orderNumber === 'string' && snapshot.orderNumber.length > 0) {
    parts.push(snapshot.orderNumber);
  }
  // Buyer email and names are personal data: indexed only when the install
  // stores it — see the module doc for why the snapshot cannot decide this.
  if (options.storePii) {
    if (typeof snapshot.customerEmail === 'string' && snapshot.customerEmail.length > 0) {
      parts.push(snapshot.customerEmail);
    }
    parts.push(...readAddressName(snapshot.billingAddress));
    parts.push(...readAddressName(snapshot.shippingAddress));
  }
  parts.push(...readItemSkus(snapshot.items));

  return parts.join(' ');
}

/**
 * The full derivation: corpus + normalization, in one call. This is what
 * `OrderRecordRepository.toOrm` calls on every write (#3527) — search text is
 * always recomputed fresh from the latest snapshot rather than incrementally
 * maintained, which is what "populated at ingestion and update time" means in
 * practice: every write recomputes it, there is no separate write path to
 * forget.
 */
export function deriveOrderSearchText(
  snapshot: Record<string, unknown>,
  options: OrderSearchTextOptions
): string {
  return normalizeOrderSearchText(buildOrderSearchCorpus(snapshot, options));
}
