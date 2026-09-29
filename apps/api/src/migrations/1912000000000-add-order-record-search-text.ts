/**
 * Add `order_records.searchText` + trigram index (#3527)
 *
 * Hand-authored: `migration:generate` emits neither the GIN index with an
 * operator class nor a jsonb-derived backfill.
 *
 * The `searchText` column is the denormalized, diacritic-folded corpus
 * `deriveOrderSearchText` (`libs/core/src/orders/domain/order-search-text.ts`)
 * computes on every write (order number, buyer name, buyer email, every line
 * SKU) — the `DestinationCategory.searchText` precedent
 * (`1833000000000-add-destination-categories-table.ts`).
 *
 * **The backfill runs in TypeScript, batched, with the normalizer COPIED in —
 * never `unaccent()`.** A migration must keep meaning what it meant when it
 * ran (the `1892000000000-inline-sales-document-rule-amounts.ts` precedent):
 * binding it to a live `@openlinker/core` import would silently change what
 * this already-applied migration meant the next time `deriveOrderSearchText`
 * is edited, and `unaccent` is not guaranteed available on every managed
 * Postgres (it is an optional contrib extension) nor guaranteed to fold the
 * same set of letters as the application's own normalizer (in particular the
 * `ł`/`ø`/`ß`-class letters NFD does not decompose either — see
 * `destination-category-search.ts`'s docblock for that exact trap). Doing the
 * backfill in application-shaped code, inlined here, is what makes the
 * one-time backfill byte-identical to what every write after this deploy
 * produces, rather than merely close.
 *
 * The copy below must match `deriveOrderSearchText` /
 * `normalizeOrderSearchText` / `buildOrderSearchCorpus` as of #3527.
 *
 * Batched by a keyset scan over the text primary key `internalOrderId`
 * (there is no numeric id to page by), 1000 rows per page, `ORDER BY
 * "internalOrderId" ASC` — a single `UPDATE ... WHERE true` would hold a
 * table-level lock for the duration of the scan on a large install.
 *
 * Timestamp is this epic's synthetic block (#3507): 1912000000000 -
 * 1912999999999. The tail on `main` at authoring time was `1901000000000`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

const BATCH_SIZE = 1000;

/**
 * Copy of `NON_DECOMPOSING_LETTERS` as of #3527 — see the module doc for why
 * this file does not import `@openlinker/core/orders`.
 */
const NON_DECOMPOSING_LETTERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ł/g, 'l'],
  [/đ/g, 'd'],
  [/ø/g, 'o'],
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
];

/** Copy of `normalizeOrderSearchText` as of #3527. */
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

/** Copy of `readAddressName` as of #3527. */
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

/** Copy of `readItemSkus` as of #3527. */
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

/** Copy of `buildOrderSearchCorpus` as of #3527. */
function buildOrderSearchCorpus(snapshot: Record<string, unknown>): string {
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

/** Copy of `deriveOrderSearchText` as of #3527. */
function deriveOrderSearchText(snapshot: Record<string, unknown>): string {
  return normalizeOrderSearchText(buildOrderSearchCorpus(snapshot));
}

interface OrderRecordRow {
  internalOrderId: string;
  orderSnapshot: Record<string, unknown> | null;
}

export class AddOrderRecordSearchText1912000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Provisioned for the `searchText LIKE '%…%'` predicate via gin_trgm_ops —
    // same reasoning as `1833000000000-add-destination-categories-table.ts`.
    // Correctness does NOT depend on it: the repository matches with `LIKE`,
    // never the `%` similarity operator, which would error where the
    // extension is unavailable (e.g. the synchronize-built test schema).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD COLUMN "searchText" text NOT NULL DEFAULT ''
    `);

    // Backfill every existing row from its already-stored jsonb snapshot,
    // in TypeScript, using the exact copy of `deriveOrderSearchText` above —
    // never `unaccent()`. Keyset-paged over the text primary key, 1000 rows
    // per page.
    let cursor: string | null = null;
    for (;;) {
      const rows: OrderRecordRow[] = cursor === null
        ? ((await queryRunner.query(
            `SELECT "internalOrderId", "orderSnapshot"
               FROM "order_records"
              WHERE "orderSnapshot" IS NOT NULL
              ORDER BY "internalOrderId" ASC
              LIMIT $1`,
            [BATCH_SIZE],
          )) as OrderRecordRow[])
        : ((await queryRunner.query(
            `SELECT "internalOrderId", "orderSnapshot"
               FROM "order_records"
              WHERE "orderSnapshot" IS NOT NULL
                AND "internalOrderId" > $1
              ORDER BY "internalOrderId" ASC
              LIMIT $2`,
            [cursor, BATCH_SIZE],
          )) as OrderRecordRow[]);

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const searchText = deriveOrderSearchText(row.orderSnapshot ?? {});
        await queryRunner.query(
          `UPDATE "order_records" SET "searchText" = $1 WHERE "internalOrderId" = $2`,
          [searchText, row.internalOrderId],
        );
      }

      cursor = rows[rows.length - 1].internalOrderId;

      if (rows.length < BATCH_SIZE) {
        break;
      }
    }

    await queryRunner.query(`
      CREATE INDEX "IDX_order_records_searchText_trgm"
        ON "order_records" USING GIN ("searchText" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_searchText_trgm"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "searchText"`);
    // The `pg_trgm` extension is intentionally NOT dropped — it may be shared
    // with `DestinationCategory.searchText`'s own trigram index.
  }
}
