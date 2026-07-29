/**
 * Bulk batch progress page object
 *
 * Covers `/listings/bulk-batches/:batchId`. Two distinct status vocabularies
 * live on this page and must not be conflated:
 *
 *   - PER-RECORD (one row per variant) in the "Bulk batch records" DataTable
 *     (`bulk-batch-progress-table.tsx:169`): `pending | running | draft |
 *     succeeded | already existed | failed` (`:353-368`). There is NO
 *     "completed" row status.
 *   - BATCH-level, rendered once in the page header
 *     (`bulk-batch-progress-page.tsx:225-235`): `pending | running | completed |
 *     partially failed | failed`.
 *
 * Every row query is scoped to the records table so the per-product rollup list
 * above it (`bulk-batch-progress-table.tsx:153`, `<ul>` — not rows) and the
 * batch badge can't leak into a count.
 *
 * @module pages
 */
import { type Locator, type Page } from '@playwright/test';

/**
 * Record statuses that mean "the offer reached the marketplace" — the row-level
 * counterpart to the batch-level "completed" badge. Mirrors the FE's
 * `LIVE_STATUSES` (`bulk-batch-progress-table.tsx:41`) mapped through
 * `RecordStatusBadge` (`:353-368`): `active → succeeded`, `reused → already
 * existed`, `draft → draft`.
 */
const LIVE_ROW_STATUSES = ['succeeded', 'already existed', 'draft'] as const;

export class BulkBatchProgressPage {
  constructor(private readonly page: Page) {}

  /** The batch id from the current URL. */
  get batchId(): string {
    const match = /\/listings\/bulk-batches\/([^/?#]+)/.exec(this.page.url());
    if (!match) {
      throw new Error(`Not on a bulk batch progress page: ${this.page.url()}`);
    }
    return match[1];
  }

  /** The per-variant records table (`bulk-batch-progress-table.tsx:169`). */
  get recordsTable(): Locator {
    return this.page.getByRole('table', { name: 'Bulk batch records' });
  }

  /**
   * Rows whose status badge means the offer went live on the marketplace.
   *
   * NOT `/completed/i` — no record row ever renders that word; only the
   * batch-level badge does, so the old predicate matched zero rows on a fully
   * successful batch.
   */
  liveRows(): Locator {
    return this.recordsTable
      .getByRole('row')
      .filter({ hasText: new RegExp(`\\b(?:${LIVE_ROW_STATUSES.join('|')})\\b`, 'i') });
  }

  /** Count of record rows whose status text matches `statusText` (case-insensitive). */
  async countRowsWithStatus(statusText: string): Promise<number> {
    return this.recordsTable
      .getByRole('row')
      .filter({ hasText: new RegExp(statusText, 'i') })
      .count();
  }
}
