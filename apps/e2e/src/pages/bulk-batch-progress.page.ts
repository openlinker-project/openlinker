/**
 * Bulk batch progress page object
 *
 * Covers `/listings/bulk-batches/:batchId`. Reached from
 * `BulkOfferWizardPage.confirmCreation()`, whose two callers
 * (the full-flow segments, `operator-setup.spec.ts`) read `batchId` and then assert
 * against the API rather than the DOM - OL's own offer mappings are the
 * authoritative signal, and the batch id is all they need from this page.
 *
 * Deliberately minimal for that reason. Row-level readers (`recordsTable`,
 * `liveRows`, `countRowsWithStatus`) existed here with ZERO callers, so they
 * were pure `apps/web`-coupled selector surface rotting against FE churn, and
 * were removed. If a row assertion is ever needed, re-add it knowing the trap
 * they encoded: two DISTINCT status vocabularies live on this page and must not
 * be conflated.
 *
 *   - PER-RECORD (one row per variant) in the "Bulk batch records" DataTable
 *     (`bulk-batch-progress-table.tsx`): `pending | running | draft | succeeded |
 *     already existed | failed`. There is NO "completed" row status - the FE's
 *     `LIVE_STATUSES` maps `active -> succeeded`, `reused -> already existed`,
 *     `draft -> draft` through `RecordStatusBadge`.
 *   - BATCH-level, rendered ONCE in the page header
 *     (`bulk-batch-progress-page.tsx`): `pending | running | completed |
 *     partially failed | failed`.
 *
 * So a `/completed/i` row predicate matches zero rows on a fully successful
 * batch, and any row query must be scoped to the records table so the
 * per-product rollup `<ul>` above it and the batch badge cannot leak into a
 * count.
 *
 * @module pages
 */
import { type Page } from '@playwright/test';

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
}
