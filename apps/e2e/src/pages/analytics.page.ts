/**
 * Analytics page object (#2482)
 *
 * Covers the real, running `/analytics` page (`apps/web/src/pages/analytics/
 * analytics-page.tsx`) — the display-currency picker, the Analytics Settings
 * dialog, and the Data Coverage panel's five drill-down modals. Selectors
 * follow the shipped component structure (checked against
 * `apps/web/src/features/analytics/components/*` at the time this was
 * written) rather than the mockup's markup, which is a separate document.
 *
 * `from`/`to`/`displayCurrency`/`rateBasis` are all URL search params
 * (ADR-064), so most state changes are a `goto()` with query params rather
 * than clicking through the toolbar.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The five Data Coverage categories that open a `CoverageDetailDialog`. */
export type CoverageCategory = 'currency' | 'tax-a' | 'tax-b' | 'tax-c' | 'product-matching';

/**
 * A substring of `deriveCoverageRowCopy(row).headline` that is constant
 * regardless of the row's affected count — mirrors
 * `apps/web/src/features/analytics/lib/data-coverage-copy.lib.ts`. Kept as a
 * literal copy (not imported — the e2e package does not depend on
 * `apps/web`) rather than a full-sentence match, since the count varies.
 */
const COVERAGE_ROW_TEXT: Record<CoverageCategory, string> = {
  currency: 'counted in an outdated currency',
  'tax-a': 'have an unconfirmed tax rate',
  'tax-b': 'have no tax rate at all',
  'tax-c': 'rate not yet resolved',
  'product-matching': 'with a product-matching error',
};

/** Modal title substring per category, from the same copy table's `modalTitle`. */
const COVERAGE_MODAL_TEXT: Record<CoverageCategory, string> = {
  currency: 'counted in an outdated currency',
  'tax-a': 'have an unconfirmed tax rate',
  'tax-b': 'have no tax rate at all',
  'tax-c': 'rate still unresolved',
  'product-matching': 'with a product-matching error',
};

export interface AnalyticsGotoOptions {
  from?: string;
  to?: string;
  displayCurrency?: string;
  rateBasis?: 'current-rate' | 'order-date';
}

export class AnalyticsPage {
  constructor(private readonly page: Page) {}

  async goto(options: AnalyticsGotoOptions = {}): Promise<void> {
    const params = new URLSearchParams();
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);
    if (options.displayCurrency) params.set('displayCurrency', options.displayCurrency);
    if (options.rateBasis) params.set('rateBasis', options.rateBasis);
    const query = params.toString();
    await this.page.goto(`/analytics${query ? `?${query}` : ''}`);
    await expect(this.page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  }

  get convertNote(): Locator {
    return this.page.locator('.alert', {
      hasText: /Converting to|Couldn.t get today.s|Rate on order date|Current rate:/,
    });
  }

  get displayCurrencySelect(): Locator {
    return this.page.getByLabel('Display currency');
  }

  get settingsButton(): Locator {
    return this.page.getByRole('button', { name: 'Analytics settings' });
  }

  get settingsDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Analytics settings' });
  }

  async openSettings(): Promise<void> {
    await this.settingsButton.click();
    await expect(this.settingsDialog).toBeVisible();
  }

  /** The Data Coverage panel's row for `category` — clickable to open its detail modal. */
  coverageRow(category: CoverageCategory): Locator {
    return this.page.locator('.row-trigger', { hasText: COVERAGE_ROW_TEXT[category] });
  }

  /**
   * The Data Coverage panel's zero-open-categories row (`AnalyticsDataCoveragePanel`,
   * `openRows.length === 0` branch): a "Clear" badge + "Nothing to do" headline.
   */
  get allClearRow(): Locator {
    return this.page.locator('.attention-list__item--resolved', { hasText: 'Nothing to do' });
  }

  async openCoverageDetail(category: CoverageCategory): Promise<Locator> {
    await this.coverageRow(category).click();
    const dialog = this.page.getByRole('dialog', { name: new RegExp(COVERAGE_MODAL_TEXT[category]) });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  get recalculateNowButton(): Locator {
    return this.page.getByRole('button', { name: /Recalculate all \d+ now/ });
  }

  get cancelStuckRunButton(): Locator {
    return this.page.getByRole('button', { name: /Cancel stuck run|Cancelling…/ });
  }

  get syncCatalogNowButton(): Locator {
    return this.page.getByRole('button', { name: /Sync the catalog for these \d+ now/ });
  }

  /**
   * Starts a real currency recalculation from an already-open detail-currency
   * modal: `handleRecalculate` (`analytics-data-coverage-panel.tsx`) is bound
   * directly to this button's `onClick` — no confirm step on THIS path
   * (unlike the Settings dialog's own "Recalculate now?" `ConfirmDialog`,
   * which sits in front of a differently-worded button and is a separate
   * flow this page object does not need). The panel closes the modal itself
   * on success (`setOpenCategory(null)`), so callers assert the currency
   * row's live badge afterward rather than this modal.
   */
  async recalculateNow(): Promise<void> {
    await this.recalculateNowButton.click();
  }

  /**
   * The Data Coverage panel's currency row, whose badge text carries the
   * live `currencyRunPhase` ('In progress' / 'Fixed' / 'Failed' / 'Status
   * unknown') once a run exists — the mockup's `currency-in-progress` /
   * `currency-fixed` / `currency-failed` states render this same row, never
   * a separate dialog (see `DIALOG_MODIFIER_BY_STATE` in
   * `analytics-mockup.page.ts`, which has no entry for any of the three).
   */
  get currencyRow(): Locator {
    return this.coverageRow('currency');
  }

  get currencyRowBadge(): Locator {
    return this.currencyRow.locator('.status-badge, [class*="status-badge"]').first();
  }
}
