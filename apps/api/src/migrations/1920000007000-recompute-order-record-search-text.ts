/**
 * Recompute `order_records.searchText` for every row (#3507 G03-1, G03-14)
 *
 * Data only, no DDL. This is the ONE full-table pass that writes
 * `searchText`: `1920000000000-add-order-record-search-text.ts` adds the column
 * with no backfill (#3633 review — a backfill there would index buyer PII on
 * an `OL_STORE_PII=false` install before this pass stripped it again), so on a
 * fresh install every pre-existing row is populated here, under the correct
 * flag.
 *
 * It also repairs databases that ran this epic's migrations before they were
 * renumbered from `1912…`: there the old first migration backfilled without
 * the flag, and until G03-1 the frozen-attribution upsert
 * (`OrderRecordRepository.buildFrozenAttributionUpsert`) enumerated its
 * columns without `searchText`, so an order ingested afterwards kept `''`
 * (unsearchable) and a re-ingested row kept whatever the backfill gave it —
 * including the PREVIOUS buyer's name for a row whose snapshot was since
 * rewritten. Every row is therefore re-derived, not only the empty ones.
 *
 * The derivation is the G03-14 one: under `OL_STORE_PII=false` only the order
 * number and line SKUs are indexed, whatever the stored snapshot still carries
 * from a time when PII storage was on. The flag is read from the same env var
 * with the same semantics the application uses (`getEnvBoolean('OL_STORE_PII',
 * true)` — `libs/shared/src/config/index.ts`, the read `getPiiConfig()` makes
 * in `libs/shared/src/config/pii-config.ts`), copied below rather than
 * imported. The worker's `OrderSearchTextReindexService` exists for the
 * RUNTIME case — the flag flipped after this migration ran — and re-applies
 * the same rule then; it is not what populates the column on deploy.
 *
 * **The derivation is COPIED, never imported** (`docs/lessons.md`, "A
 * migration backfill must copy application logic, never call it"): a
 * migration must keep meaning what it meant when it ran, and binding it to a
 * live `@openlinker/core` import would change this already-applied
 * migration's meaning the next time `deriveOrderSearchText` is edited. The
 * copy below must match, as of #3507 G03-14:
 * - `normalizeOrderSearchText`, `buildOrderSearchCorpus`,
 *   `deriveOrderSearchText`, `readAddressName`, `readItemSkus` and
 *   `NON_DECOMPOSING_LETTERS` in `libs/core/src/orders/domain/order-search-text.ts`;
 * - `getEnvBoolean` in `libs/shared/src/config/index.ts`.
 *
 * The derivation runs in TypeScript, never `unaccent()`: that is an optional
 * contrib extension not guaranteed on every managed Postgres, and it does not
 * fold the same letters as the application's normalizer (the `ł`/`ø`/`ß`
 * class NFD leaves alone — `destination-category-search.ts`'s docblock).
 *
 * Keyset-paged over the text primary key (there is no numeric id),
 * `PAGE_SIZE` rows per page. Each page is written with ONE set-based
 * statement — `UPDATE … FROM (VALUES …)` with bound parameters, the shape
 * #3660 adopted — rather than one `UPDATE` per row, so a large install pays
 * one round-trip per page, not per order (#3633 review). Rows whose stored
 * text already equals the derivation are left out of the `VALUES` list, and
 * the `IS DISTINCT FROM` predicate keeps the statement a no-op for them even
 * so. `updatedAt` is left alone — the text is derived data, not a change to
 * the order. A plain row-level `UPDATE` takes no table lock beyond `ROW
 * EXCLUSIVE`, so concurrent reads of `order_records` are not blocked.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1920000006000-create-order-exports.ts`. Renumbered from `1912000007000`
 * (#3633 review); it carries no DDL, and re-running it is a no-op by
 * construction (every unchanged row is skipped).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 500 rows → at most 1000 bound parameters per `UPDATE`, far below Postgres'
 * 65535-parameter ceiling while keeping each statement's row locks short.
 */
const PAGE_SIZE = 500;

/** Copy of `getEnvBoolean` (`libs/shared/src/config/index.ts`) as of #3507 G03-14. */
function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/** Copy of `NON_DECOMPOSING_LETTERS` as of #3507 G03-14. */
const NON_DECOMPOSING_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ø/g, 'o'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
];

/** Copy of `normalizeOrderSearchText` as of #3507 G03-14. */
function normalizeOrderSearchText(value: string): string {
  let normalized = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  for (const [pattern, replacement] of NON_DECOMPOSING_LETTERS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.trim().replace(/\s+/g, ' ');
}

/** Copy of `readAddressName` as of #3507 G03-14. */
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

/** Copy of `readItemSkus` as of #3507 G03-14. */
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

/** Copy of `buildOrderSearchCorpus` as of #3507 G03-14. */
function buildOrderSearchCorpus(
  snapshot: Record<string, unknown>,
  options: { readonly storePii: boolean }
): string {
  const parts: string[] = [];

  if (typeof snapshot.orderNumber === 'string' && snapshot.orderNumber.length > 0) {
    parts.push(snapshot.orderNumber);
  }
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

/** Copy of `deriveOrderSearchText` as of #3507 G03-14. */
function deriveOrderSearchText(
  snapshot: Record<string, unknown>,
  options: { readonly storePii: boolean }
): string {
  return normalizeOrderSearchText(buildOrderSearchCorpus(snapshot, options));
}

interface OrderRecordRow {
  internalOrderId: string;
  orderSnapshot: unknown;
  searchText: string | null;
}

interface SearchTextRewrite {
  internalOrderId: string;
  searchText: string;
}

/**
 * One set-based `UPDATE` for a page's changed rows. Every value is a bound
 * parameter (`$n::text`) — never interpolated — so a snapshot-derived string
 * cannot alter the statement.
 */
async function writePage(
  queryRunner: QueryRunner,
  rewrites: readonly SearchTextRewrite[]
): Promise<void> {
  if (rewrites.length === 0) {
    return;
  }

  const tuples: string[] = [];
  const params: string[] = [];
  for (const rewrite of rewrites) {
    tuples.push(`($${params.length + 1}::text, $${params.length + 2}::text)`);
    params.push(rewrite.internalOrderId, rewrite.searchText);
  }

  await queryRunner.query(
    `UPDATE "order_records" AS r
        SET "searchText" = v."searchText"
       FROM (VALUES ${tuples.join(', ')}) AS v("internalOrderId", "searchText")
      WHERE r."internalOrderId" = v."internalOrderId"
        AND r."searchText" IS DISTINCT FROM v."searchText"`,
    params
  );
}

export class RecomputeOrderRecordSearchText1920000007000 implements MigrationInterface {
  name = 'RecomputeOrderRecordSearchText1920000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const storePii = getEnvBoolean('OL_STORE_PII', true);

    let cursor: string | null = null;
    for (;;) {
      const rows: OrderRecordRow[] =
        cursor === null
          ? ((await queryRunner.query(
              `SELECT "internalOrderId", "orderSnapshot", "searchText"
                 FROM "order_records"
                ORDER BY "internalOrderId" ASC
                LIMIT $1`,
              [PAGE_SIZE]
            )) as OrderRecordRow[])
          : ((await queryRunner.query(
              `SELECT "internalOrderId", "orderSnapshot", "searchText"
                 FROM "order_records"
                WHERE "internalOrderId" > $1
                ORDER BY "internalOrderId" ASC
                LIMIT $2`,
              [cursor, PAGE_SIZE]
            )) as OrderRecordRow[]);

      if (rows.length === 0) {
        break;
      }

      const rewrites: SearchTextRewrite[] = [];
      for (const row of rows) {
        const snapshot =
          typeof row.orderSnapshot === 'object' && row.orderSnapshot !== null
            ? (row.orderSnapshot as Record<string, unknown>)
            : {};
        const searchText = deriveOrderSearchText(snapshot, { storePii });
        if (searchText !== (row.searchText ?? '')) {
          rewrites.push({ internalOrderId: row.internalOrderId, searchText });
        }
      }
      await writePage(queryRunner, rewrites);

      cursor = rows[rows.length - 1].internalOrderId;

      if (rows.length < PAGE_SIZE) {
        break;
      }
    }
  }

  public async down(): Promise<void> {
    // Intentionally a no-op. `searchText` is derived data: the "before" state
    // was empty or stale text, not a value worth restoring, and the column
    // itself belongs to `1920000000000`, whose own `down` drops it.
  }
}
