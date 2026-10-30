/**
 * Delivery-on-documents page objects (#3912)
 *
 * Locators for the Mappings "Delivery on documents" tab (#3908) and the
 * "Sales documents" step of the Allegro and Erli setup wizards (#3911), taken
 * from the real components (`features/delivery-on-documents/components/*`).
 * Kept in ONE place so the tab, wizard and visual specs share them.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The editor dialog (add / edit a country row). Shared by the tab and the wizard. */
export class DeliveryEditorDialog {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.getByRole('dialog');
  }

  title(name: string | RegExp): Locator {
    return this.root.getByRole('heading', { name });
  }

  /** The native "Fill in from" select; its value is the suggestion's country code. */
  get fillIn(): Locator {
    return this.root.locator('select[id^="dd-fill-"]');
  }

  get rate(): Locator {
    return this.root.locator('select[id^="dd-rate-"]');
  }

  get fixedRate(): Locator {
    return this.root.locator('input[id^="dd-fixed-rate-"]');
  }

  /** The "Name of the delivery line" select (its accessible name is set by aria-label). */
  get nameSelect(): Locator {
    return this.root.getByRole('combobox', { name: 'Name of the delivery line', exact: true });
  }

  /** Pick the country in the "Buyer country" combobox (add mode). */
  async pickCountry(search: string, optionName: string | RegExp): Promise<void> {
    await this.root.getByRole('combobox').first().click();
    await this.page.locator('.combobox__search').fill(search);
    await this.page.getByRole('option', { name: optionName }).first().click();
  }

  /** Choose "Type my own…" and type a name of the operator's own. */
  async typeOwnName(name: string): Promise<void> {
    await this.nameSelect.selectOption({ label: 'Type my own…' });
    await this.root
      .getByRole('textbox', { name: 'Name of the delivery line, your own' })
      .fill(name);
    await this.root.getByRole('button', { name: 'Use this name' }).click();
  }

  button(name: string | RegExp): Locator {
    return this.root.getByRole('button', { name });
  }
}

export class DeliveryOnDocumentsTab {
  readonly editor: DeliveryEditorDialog;

  constructor(private readonly page: Page) {
    this.editor = new DeliveryEditorDialog(page);
  }

  async goto(connectionId: string): Promise<void> {
    await this.page.goto(`/connections/${connectionId}/mappings`);
    const tab = this.page.getByRole('tab', { name: 'Delivery on documents' });
    await expect(tab).toBeVisible({ timeout: 30_000 });
    await tab.click();
    await expect(this.panel).toBeVisible();
  }

  /** The tab's own panel (`.dd-panel`), not the surrounding tab chrome. */
  get panel(): Locator {
    return this.page.locator('.dd-panel');
  }

  /** The strip that suggests the busiest unconfigured country. */
  get suggestionStrip(): Locator {
    return this.panel.locator('.dd-suggest');
  }

  /** Table row by its visible text (country name or delivery line). */
  row(text: string | RegExp): Locator {
    return this.panel.getByRole('row').filter({ hasText: text });
  }

  button(name: string | RegExp): Locator {
    return this.panel.getByRole('button', { name });
  }

  editButton(country: string): Locator {
    return this.panel.getByRole('button', { name: `Edit ${country}` });
  }

  /** The "saved / removed" status notice. */
  get notice(): Locator {
    return this.panel.getByRole('status');
  }

  get exampleDetails(): Locator {
    return this.panel.locator('details.dd-example');
  }
}

/** The shared "Sales documents" wizard step (`.dd-wizard`). */
export class DeliveryWizardStepView {
  constructor(private readonly page: Page) {}

  get root(): Locator {
    return this.page.locator('.dd-wizard');
  }

  get suggestedChoice(): Locator {
    return this.page.getByRole('radio', { name: /Use the suggested settings/ });
  }

  get ownChoice(): Locator {
    return this.page.getByRole('radio', { name: /Set it up myself/ });
  }

  get miniReceipt(): Locator {
    return this.root.locator('.dd-mini');
  }

  get ownTable(): Locator {
    return this.root.getByRole('table', { name: 'Delivery line per buyer country' });
  }
}

/** Drives `/connections/new/allegro` up to the "Sales documents" step. */
export class AllegroWizardPage {
  readonly step: DeliveryWizardStepView;

  constructor(private readonly page: Page) {
    this.step = new DeliveryWizardStepView(page);
  }

  async goto(): Promise<void> {
    await this.page.goto('/connections/new/allegro');
    await expect(this.page.getByLabel('Connection name')).toBeVisible({ timeout: 30_000 });
  }

  next(): Locator {
    return this.page.getByRole('button', { name: 'Next', exact: true });
  }

  /** Dummy credentials, then Next through Environment and Product catalog. */
  async advanceToSalesDocuments(name: string): Promise<void> {
    await this.page.getByLabel('Connection name').fill(name);
    await this.page.getByLabel('Client ID').fill('delivery-e2e-client-id');
    await this.page.getByLabel('Client secret').fill('delivery-e2e-client-secret');
    await this.next().click();
    await expect(this.page.getByLabel('Environment')).toBeVisible();
    await this.next().click();
    await this.next().click();
    await expect(this.step.root).toBeVisible();
  }
}

/** Drives `/connections/new/erli`. */
export class ErliWizardPage {
  readonly step: DeliveryWizardStepView;

  constructor(private readonly page: Page) {
    this.step = new DeliveryWizardStepView(page);
  }

  async goto(): Promise<void> {
    await this.page.goto('/connections/new/erli');
    await expect(this.page.getByLabel('Connection name')).toBeVisible({ timeout: 30_000 });
  }

  async fillCredentials(name: string, apiKey: string): Promise<void> {
    await this.page.getByLabel('Connection name').fill(name);
    await this.page.getByLabel('API key').fill(apiKey);
    await this.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(this.step.root).toBeVisible();
  }
}
