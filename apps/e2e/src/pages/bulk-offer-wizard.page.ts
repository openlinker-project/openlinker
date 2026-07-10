/**
 * Bulk offer wizard page object (Allegro / Erli)
 *
 * Covers `/listings/bulk-create/wizard` → the SetupStepper flow
 * (Config → Resolving → Review → Confirm) rendered by `bulk/bulk-wizard.tsx`,
 * the confirm modal, and the transition to the batch progress page
 * (`/listings/bulk-batches/:batchId`).
 *
 * Step CTAs mirror the real components: "Proceed →" on the config step
 * (`bulk-config-step.tsx`), the resolve step auto-advances when its batch
 * queries settle (`bulk-resolve-step.tsx`), and "Approve all (N)" on the
 * review step opens the confirm modal (`bulk-review-step.tsx`). "Approve all"
 * stays disabled while any row needs attention, so the flow fails fast on a
 * non-zero needs-attention count instead of timing out on a disabled button.
 *
 * Marketplace connection selection is only shown when more than one eligible
 * connection exists; with a single connection the wizard shows "Publishing as
 * {name}" and no select.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { selectOptionByText } from '../support/selectors';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';

export class BulkOfferWizard {
  constructor(private readonly page: Page) {}

  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Bulk marketplace offer creation' }),
    ).toBeVisible();
  }

  get marketplaceConnectionSelect(): Locator {
    return this.page.getByLabel('Marketplace connection');
  }

  /** Select the marketplace connection if the picker is present (multi-connection). */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if (await this.marketplaceConnectionSelect.count()) {
      await selectOptionByText(this.marketplaceConnectionSelect, connectionName);
    }
  }

  /** The Allegro platform section's delivery-policy select ("Shipping rate package"). */
  get deliveryPolicySelect(): Locator {
    return this.page.getByLabel('Shipping rate package');
  }

  /**
   * Complete the required per-platform config the config step gates "Proceed" on.
   * Allegro requires a delivery (shipping-rate) policy; currency auto-defaults to
   * PLN. The select is populated from the connection's seller policies, so wait
   * for it to enable, then pick the first real option. No-op for platforms
   * (Erli) that don't render it.
   */
  async completePlatformConfig(): Promise<void> {
    if ((await this.deliveryPolicySelect.count()) === 0) return;
    await expect(this.deliveryPolicySelect).toBeEnabled({ timeout: 30_000 });
    const value = await this.deliveryPolicySelect
      .locator('option:not([value=""])')
      .first()
      .getAttribute('value');
    expect(value, 'Allegro connection exposes at least one delivery policy').toBeTruthy();
    await this.deliveryPolicySelect.selectOption(value!);
  }

  /** The config step's forward CTA ("Proceed →", `bulk-config-step.tsx`). */
  get proceedButton(): Locator {
    return this.page.getByRole('button', { name: /^Proceed/ });
  }

  /** The review step's submit CTA ("Approve all (N)", `bulk-review-step.tsx`). */
  get approveAllButton(): Locator {
    return this.page.getByRole('button', { name: /^Approve all \(\d+\)$/ });
  }

  /**
   * The needs-attention count on the review step (0 when the hint is absent).
   * Rendered as a `role="status"` hint: "N row(s) need attention…".
   */
  async needsAttentionCount(): Promise<number> {
    const hint = this.page.getByRole('status').filter({ hasText: /needs? attention/ });
    if ((await hint.count()) === 0) {
      return 0;
    }
    const text = (await hint.first().innerText()).trim();
    const match = /^(\d+)/.exec(text);
    return match ? Number(match[1]) : 1;
  }

  /**
   * Drive Config → Resolving → Review and open the confirm modal.
   *
   * The resolve step runs two batch queries and auto-advances to Review on
   * settle, so the only clicks are "Proceed →" and "Approve all (N)". Fails
   * fast when any review row needs attention (missing category/params) — the
   * spec does no row editing, so a needs-attention row can never be submitted.
   */
  async advanceToConfirmModal(): Promise<void> {
    await this.completePlatformConfig();
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.approveAllButton).toBeVisible({ timeout: 60_000 });

    const needsAttention = await this.needsAttentionCount();
    expect(
      needsAttention,
      `${needsAttention} review row(s) need attention (missing category/params); ` +
        'the automated flow does no row editing — fix the rows on the stack first',
    ).toBe(0);

    // `canApprove` also waits out platform parameter resolution (`paramsResolving`).
    await expect(this.approveAllButton).toBeEnabled({ timeout: 30_000 });
    await this.approveAllButton.click();
    await expect(this.confirmModalConfirmButton).toBeVisible();
  }

  get confirmModalConfirmButton(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Create offers' });
  }

  get publishImmediatelyCheckbox(): Locator {
    return this.page.getByRole('dialog').getByRole('checkbox', { name: 'Publish immediately' });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
