/**
 * Bulk batch progress page object
 *
 * Covers `/listings/bulk-batches/:batchId` — the per-variant progress view
 * shown after a bulk offer batch is submitted. Row statuses render as
 * StatusBadge text (`pending`, `running`, `completed`, `partially failed`,
 * `failed`); the per-variant table lives in `bulk-batch-progress-table.tsx`.
 *
 * @module pages
 */
import { type Locator, type Page } from '@playwright/test';

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

  /** All rows currently rendered with a "completed" status badge. */
  completedRows(): Locator {
    return this.page.getByRole('row').filter({ hasText: /completed/i });
  }

  /** Count of rows whose status text matches `statusText` (case-insensitive). */
  async countRowsWithStatus(statusText: string): Promise<number> {
    return this.page
      .getByRole('row')
      .filter({ hasText: new RegExp(statusText, 'i') })
      .count();
  }
}
