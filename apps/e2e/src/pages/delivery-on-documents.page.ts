/**
 * Delivery-on-documents page objects (#3912)
 *
 * Scaffolding for the Mappings "Delivery on documents" tab. Locators are
 * role/label based and kept in ONE place so the tab specs and the visual spec
 * share them; the frontend tab and wizard step land in #3908 / #3911, so the
 * accessible names below follow the issue and the mockup and are confirmed
 * against the merged UI when those specs are written.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

export class DeliveryOnDocumentsTab {
  constructor(private readonly page: Page) {}

  async goto(connectionId: string): Promise<void> {
    await this.page.goto(`/connections/${connectionId}/mappings`);
    await this.tab.click();
    await expect(this.tab).toHaveAttribute('aria-selected', 'true');
  }

  get tab(): Locator {
    return this.page.getByRole('tab', { name: 'Delivery on documents' });
  }

  /** The tab panel everything below lives in. */
  get root(): Locator {
    return this.page.getByRole('tabpanel', { name: 'Delivery on documents' });
  }

  get suggestionStrip(): Locator {
    return this.root.locator('[data-testid="delivery-suggestion-strip"]');
  }

  /** A configured country row, found by its visible text (country name or delivery name). */
  row(text: string | RegExp): Locator {
    return this.root.getByRole('row').filter({ hasText: text });
  }

  button(name: string | RegExp): Locator {
    return this.root.getByRole('button', { name });
  }

  get editorDialog(): Locator {
    return this.page.getByRole('dialog');
  }
}
