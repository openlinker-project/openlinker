/**
 * Buyer data rules (#4289)
 *
 * The three surfaces of one feature, end to end: the general settings page
 * (defaults, trial run, enabling), the new-connection wizard (general settings
 * by default, own rules stored as periods only and following the general switch) and the connection edit (own rules,
 * trial run, enabling, saved into `config.buyerDataRetention`).
 *
 * Runs against a real stack (`pnpm exec playwright test --project=buyer-data`).
 * Requirements: `E2E_DATABASE_URL` pointing at the stack's Postgres (the
 * connections it creates are deleted there afterwards), and the GLOBAL buyer
 * data setting OFF before the run. The first test turns it on and switches it
 * off again within the same test, so it is safe to re-run.
 *
 * @module tests/buyer-data
 */
import { test, expect } from '../../src/fixtures/test';
import { deleteConnectionsByName } from '../../src/support/delivery-on-documents-seed';

const INHERIT_NAME = `Buyer data E2E inherit ${String(Date.now())}`;
const OWN_NAME = `Buyer data E2E own ${String(Date.now())}`;

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await deleteConnectionsByName(INHERIT_NAME);
  await deleteConnectionsByName(OWN_NAME);
});

test('general settings: switch locked until the plan is calculated, then saved', async ({
  page,
  pages,
}) => {
  const settings = pages.buyerDataSettings;

  await test.step('the tile on Settings leads to the page', async () => {
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Manage' }).last().click();
    await expect(page).toHaveURL(/\/settings\/buyer-data$/);
  });

  await test.step('it says these are defaults and starts with the rules off', async () => {
    await expect(page.getByText('These are default settings')).toBeVisible();
    await expect(settings.masterSwitch).toHaveAttribute('aria-checked', 'false');
  });

  await test.step('choosing periods updates the plan and the example order', async () => {
    await settings.rules.choose({ amount: 3, unit: 'months' }, { amount: 2, unit: 'years' });
    await expect(settings.rules.summary).toContainText('will leave the lists');
    await expect(settings.rules.exampleOrder).toBeVisible();
  });

  await test.step('the calculated plan unlocks the switch and changes nothing', async () => {
    await expect(settings.rules.plan).toContainText('Calculated at');
    await expect(settings.masterSwitch).toBeEnabled();
    await expect(settings.masterSwitch).toHaveAttribute('aria-checked', 'false');
  });

  await test.step('turning the rules on asks for confirmation, then saves', async () => {
    await settings.masterSwitch.click();
    await settings.save.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Buyer data rules saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(settings.rules.hideAmount).toHaveValue('3');
    await expect(settings.masterSwitch).toHaveAttribute('aria-checked', 'true');
  });

  await test.step('the switch is put back off so the run leaves no live rules behind', async () => {
    await settings.masterSwitch.click();
    await settings.save.click();
    await expect(page.getByText('Buyer data rules saved.', { exact: true })).toBeVisible();
  });
});

test('Erli wizard: general settings by default, own rules saved without an enabled key', async ({
  page,
  pages,
  api,
}) => {
  const wizard = pages.erliWizard;
  const step = pages.buyerDataWizardStep;

  async function createErli(name: string, own: boolean): Promise<void> {
    await wizard.goto();
    await wizard.fillCredentials(name, 'buyer-data-e2e-dummy-key');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(step.root).toBeVisible();
    await expect(step.inheritOption).toBeChecked();
    if (own) {
      await step.ownOption.check();
      await step.rules.choose({ amount: 6, unit: 'months' }, { amount: 3, unit: 'years' });
    }
    await page.getByRole('button', { name: 'Connect Erli' }).click();
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible({
      timeout: 30_000,
    });
  }

  await test.step('default: the connection stores no rules and inherits', async () => {
    await createErli(INHERIT_NAME, false);
    const created = (await api.connections.list()).find((c) => c.name === INHERIT_NAME);
    expect(created, 'the inheriting connection was created').toBeDefined();
    expect((created?.config as Record<string, unknown>)['buyerDataRetention']).toBeUndefined();
  });

  await test.step('own: the periods are stored and the connection follows the general switch', async () => {
    await createErli(OWN_NAME, true);
    const created = (await api.connections.list()).find((c) => c.name === OWN_NAME);
    const stored = (created?.config as Record<string, unknown>)['buyerDataRetention'];
    expect(stored).toMatchObject({ hideAfterDays: 180, eraseAfterDays: 1095 });
    expect(stored).not.toHaveProperty('enabled');
  });
});

test('connection edit: own rules need a trial run, then are saved into the config', async ({
  page,
  pages,
  api,
}) => {
  const section = pages.buyerDataSection;
  const connection = (await api.connections.list()).find((c) => c.name === INHERIT_NAME);
  expect(connection, 'the inheriting connection exists').toBeDefined();
  const connectionId = connection?.id ?? '';

  await test.step('it inherits the general rules and shows no questions', async () => {
    await section.goto(connectionId);
    await expect(section.inheritOption).toBeChecked();
    await expect(page.getByText('Same as the general settings:')).toBeVisible();
  });

  await test.step('taking own rules keeps following the general switch (off here)', async () => {
    await section.ownOption.check();
    await expect(section.enabledSwitch).toHaveAttribute('aria-checked', 'false');
    await section.rules.choose({ amount: 1, unit: 'years' }, { amount: 2, unit: 'years' });
  });

  await test.step('the trial run unlocks the switch', async () => {
    await expect(section.rules.plan).toContainText('Calculated at');
    await section.enabledSwitch.click();
  });

  await test.step('saving writes config.buyerDataRetention', async () => {
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(async () => {
        const saved = await api.connections.getById(connectionId);
        return (saved.config as Record<string, unknown>)['buyerDataRetention'];
      })
      .toMatchObject({ enabled: true, hideAfterDays: 365, eraseAfterDays: 730 });
  });

  await test.step('returning to the general rules writes an explicit null', async () => {
    await section.goto(connectionId);
    await section.inheritOption.check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect
      .poll(async () => {
        const saved = await api.connections.getById(connectionId);
        return (saved.config as Record<string, unknown>)['buyerDataRetention'] ?? null;
      })
      .toBeNull();
  });
});
