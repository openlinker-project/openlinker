/**
 * Analytics margin panel, banners and CSV export buttons (#3591)
 *
 * Analytics lives at `/` (the old `/analytics` is a redirect shim that drops
 * the query). Range, channel and basis are URL params, so state changes are a
 * `goto`. Export buttons carry per-report test ids.
 *
 * @module pages
 */
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { slugOf } from './variant-cost.page';

export type ExportReport = 'sales-channel' | 'top-products' | 'margin-channel' | 'margin-product';

export class MarginPanelPage {
  constructor(private readonly page: Page) {}

  async goto(params: { from?: string; to?: string; sourceConnectionId?: string; netGrossBasis?: 'gross' | 'net' } = {}): Promise<void> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) search.set(key, value);
    }
    const query = search.toString();
    await this.page.goto(`/${query ? `?${query}` : ''}`);
    await expect(this.page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  }

  get panel(): Locator {
    return this.page.getByTestId('margin-panel');
  }

  get trend(): Locator {
    return this.page.getByTestId('margin-trend');
  }

  get byChannelTable(): Locator {
    return this.page.getByTestId('margin-by-channel-table');
  }

  get byProductTable(): Locator {
    return this.page.getByTestId('margin-by-product-table');
  }

  channelRow(connectionId: string): Locator {
    return this.page.getByTestId(`margin-channel-row-${connectionId}`);
  }

  productRow(sku: string): Locator {
    return this.page.getByTestId(`margin-product-row-${slugOf(sku).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
  }

  get coverageNote(): Locator {
    return this.page.getByTestId('margin-coverage-note');
  }

  get coverageToggle(): Locator {
    return this.page.getByTestId('margin-coverage-toggle');
  }

  get coverageDetails(): Locator {
    return this.page.getByTestId('margin-coverage-details');
  }

  coverageReason(reason: string): Locator {
    return this.page.getByTestId(`margin-coverage-reason-${reason}`);
  }

  get missingCostEmpty(): Locator {
    return this.page.getByTestId('margin-missing-cost-empty');
  }

  get missingCostList(): Locator {
    return this.page.getByTestId('margin-missing-cost-list');
  }

  kpi(name: 'net-revenue' | 'cost' | 'margin' | 'margin-pct'): Locator {
    return this.page.getByTestId(`margin-kpi-${name}`);
  }

  get costBanner(): Locator {
    return this.page.getByTestId('cost-coverage-banner');
  }

  exportButton(report: ExportReport): Locator {
    return this.page.getByTestId(`export-csv-${report}`);
  }

  get exportStatus(): Locator {
    return this.page.getByTestId('export-status');
  }

  /** Click an export button and capture the browser download it starts. */
  async download(report: ExportReport): Promise<Download> {
    const downloadPromise = this.page.waitForEvent('download', { timeout: 60_000 });
    await this.exportButton(report).click();
    return downloadPromise;
  }

  get settingsButton(): Locator {
    return this.page.getByRole('button', { name: 'Analytics settings' });
  }

  get trackMarginToggle(): Locator {
    return this.page.getByTestId('settings-margin-tracking-toggle');
  }

  /** Visible text of one `<table>` as rows of cell strings, for CSV-vs-screen comparison. */
  async tableRows(table: Locator): Promise<string[][]> {
    return table.locator('tbody tr').evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => (cell.textContent ?? '').trim())),
    );
  }
}
