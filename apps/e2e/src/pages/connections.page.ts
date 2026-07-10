/**
 * Connections page objects
 *
 * `ConnectionsListPage` covers the `/connections` DataTable (caption
 * "Configured connections"); `ConnectionDetailPage` covers `/connections/:id`
 * and its "Trigger sync…" launcher.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { TriggerSyncDialog } from './trigger-sync-dialog.page';

export class ConnectionsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/connections');
    await expect(this.page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  }

  /** The connections DataTable (its caption is the accessible name). */
  get table(): Locator {
    return this.page.getByRole('table', { name: 'Configured connections' });
  }

  get platformFilter(): Locator {
    return this.page.getByRole('combobox', { name: 'Filter by platform' });
  }

  /** A row locator identified by the connection's display name. */
  row(connectionName: string): Locator {
    return this.table.getByRole('row').filter({ hasText: connectionName });
  }

  async open(connectionName: string): Promise<void> {
    await this.row(connectionName).click();
    await this.page.waitForURL(/\/connections\/[^/]+$/);
  }
}

export class ConnectionDetailPage {
  constructor(private readonly page: Page) {}

  /**
   * Navigate to a connection. The detail page is tab-driven via `?tab=`; the
   * "Trigger sync…" action lives under the Actions tab, so default there so the
   * button is mounted and visible.
   */
  async goto(connectionId: string, tab: 'overview' | 'health' | 'actions' | 'config' = 'actions'): Promise<void> {
    await this.page.goto(`/connections/${connectionId}?tab=${tab}`);
  }

  get triggerSyncButton(): Locator {
    return this.page.getByRole('button', { name: 'Trigger sync…' });
  }

  /** Open the trigger-sync dialog and return its page object. */
  async openTriggerSync(): Promise<TriggerSyncDialog> {
    await this.triggerSyncButton.click();
    const dialog = new TriggerSyncDialog(this.page);
    await dialog.expectVisible();
    return dialog;
  }
}
