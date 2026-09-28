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
 * Whatever PII redaction already applied to the snapshot (`OL_STORE_PII=false`
 * writes `[REDACTED]` / omits fields entirely) flows through unchanged — this
 * function only ever reads what the snapshot already carries, so an install
 * that does not store PII simply cannot be searched by buyer name or email,
 * which is the honest reading of a redacted snapshot rather than a special
 * case coded here.
 *
 * @module libs/core/src/orders/domain
 */

/**
 * Letters NFD does NOT decompose — see `normalizeCategorySearchText`'s
 * docblock for the full rationale (the `ł` / `Artykuły` trap). Kept in sync by
 * inspection; both lists are short and rarely change.
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
export function buildOrderSearchCorpus(snapshot: Record<string, unknown>): string {
  const parts: string[] = [];

  if (typeof snapshot.orderNumber === 'string' && snapshot.orderNumber.length > 0) {
    parts.push(snapshot.orderNumber);
  }
  if (typeof snapshot.customerEmail === 'string' && snapshot.customerEmail.length > 0) {
    parts.push(snapshot.customerEmail);
  }
  parts.push(...readAddressName(snapshot.billingAddress));
  parts.push(...readAddressName(snapshot.shippingAddress));
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
export function deriveOrderSearchText(snapshot: Record<string, unknown>): string {
  return normalizeOrderSearchText(buildOrderSearchCorpus(snapshot));
}
