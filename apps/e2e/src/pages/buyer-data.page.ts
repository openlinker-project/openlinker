/**
 * Buyer data page objects (#4289)
 *
 * Locators for the general settings page (`/settings/buyer-data`), the
 * "Buyer data" section of the connection edit and the wizard step, taken from
 * the real components (`features/buyer-data/components/*`, test ids included).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** The two period questions and the trial run, shared by every surface. */
export class BuyerDataRules {
  constructor(
    private readonly root: Locator,
    private readonly name: string
  ) {}

  /** The select of the "when to hide" question. */
  get hideSelect(): Locator {
    return this.root
      .getByTestId(`buyer-data-period-${this.name}-hide`)
      .getByRole('combobox')
      .first();
  }

  get eraseSelect(): Locator {
    return this.root
      .getByTestId(`buyer-data-period-${this.name}-erase`)
      .getByRole('combobox')
      .first();
  }

  get summary(): Locator {
    return this.root.getByTestId('buyer-data-summary');
  }

  get journey(): Locator {
    return this.root.getByTestId('buyer-data-journey');
  }

  get trialRun(): Locator {
    return this.root.getByTestId('buyer-data-trial-run');
  }

  get trialResult(): Locator {
    return this.root.getByTestId('buyer-data-trial-result');
  }

  async choose(hide: string, erase: string): Promise<void> {
    await this.hideSelect.selectOption({ label: hide });
    await this.eraseSelect.selectOption({ label: erase });
  }
}

export class BuyerDataSettingsPage {
  readonly rules: BuyerDataRules;

  constructor(private readonly page: Page) {
    this.rules = new BuyerDataRules(page.getByTestId('buyer-data-page'), 'general');
  }

  async goto(): Promise<void> {
    await this.page.goto('/settings/buyer-data');
    await expect(this.page.getByTestId('buyer-data-page')).toBeVisible({ timeout: 30_000 });
  }

  get masterSwitch(): Locator {
    return this.page.getByTestId('buyer-data-master-switch');
  }

  get save(): Locator {
    return this.page.getByTestId('buyer-data-save');
  }

  get offNote(): Locator {
    return this.page.getByTestId('buyer-data-off-note');
  }

  get connectionsTable(): Locator {
    return this.page.getByTestId('buyer-data-connections');
  }
}

/** The section on `/connections/:id/edit`. */
export class BuyerDataConnectionSection {
  readonly root: Locator;
  readonly rules: BuyerDataRules;

  constructor(private readonly page: Page) {
    this.root = page.getByTestId('buyer-data-section');
    this.rules = new BuyerDataRules(this.root, 'connection');
  }

  async goto(connectionId: string): Promise<void> {
    await this.page.goto(`/connections/${connectionId}/edit`);
    await expect(this.root).toBeVisible({ timeout: 30_000 });
  }

  get inheritOption(): Locator {
    return this.root.getByRole('radio', { name: 'Same as general' });
  }

  get ownOption(): Locator {
    return this.root.getByRole('radio', { name: 'Set own' });
  }

  get enabledSwitch(): Locator {
    return this.root.getByTestId('buyer-data-enabled');
  }
}

/** The wizard step inside the Erli review step. */
export class BuyerDataWizardStepView {
  readonly root: Locator;
  readonly rules: BuyerDataRules;

  constructor(page: Page) {
    this.root = page.getByTestId('buyer-data-wizard-step');
    this.rules = new BuyerDataRules(this.root, 'wizard');
  }

  get inheritOption(): Locator {
    return this.root.getByRole('radio', { name: 'Use general settings (recommended)' });
  }

  get ownOption(): Locator {
    return this.root.getByRole('radio', { name: 'Set own' });
  }
}
