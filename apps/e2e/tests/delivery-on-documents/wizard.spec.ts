/**
 * "Sales documents" step of the connection wizards (#3912, #3911, ADR-079)
 *
 * Allegro: both choices render and the recommended one previews a mini
 * receipt; "Set it up myself" reveals the table; the OAuth start request
 * (stubbed - there is no real Allegro consent screen here) carries
 * `deliveryOnDocuments`. Erli: finishing with the suggested settings creates a
 * connection whose config names the Polish delivery line, read back from the API.
 *
 * @module tests/delivery-on-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  cleanupDeliveryOnDocuments,
  deleteConnectionsByName,
  seedDeliveryOnDocuments,
} from '../../src/support/delivery-on-documents-seed';

const ERLI_NAME = `Delivery E2E Erli ${String(Date.now())}`;

test.beforeAll(async () => {
  await seedDeliveryOnDocuments();
});

test.afterAll(async () => {
  await deleteConnectionsByName(ERLI_NAME);
  await cleanupDeliveryOnDocuments();
});

test('Allegro wizard: both choices, the own table, and the request body', async ({
  page,
  pages,
  env,
}) => {
  const wizard = pages.allegroWizard;
  let requestBody: Record<string, unknown> | null = null;

  await page.route('**/v1/integrations/allegro/oauth/connect', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ authorizationUrl: `${env.webUrl}/connections` }),
    });
  });

  await test.step('fill the credentials and reach "Sales documents"', async () => {
    await wizard.goto();
    await wizard.advanceToSalesDocuments('Delivery E2E wizard');
  });

  await test.step('both choices render; the suggested one is on and shows a mini receipt', async () => {
    await expect(wizard.step.suggestedChoice).toBeVisible();
    await expect(wizard.step.ownChoice).toBeVisible();
    await expect(wizard.step.suggestedChoice).toBeChecked();
    await expect(wizard.step.miniReceipt).toContainText('Receipt for an order from Poland');
    await expect(wizard.step.miniReceipt).toContainText('Koszt dostawy 23%');
  });

  await test.step('"Set it up myself" shows the country table', async () => {
    await wizard.step.ownChoice.check();
    await expect(wizard.step.ownTable).toBeVisible();
    await expect(wizard.step.miniReceipt).toHaveCount(0);
  });

  await test.step('Review & connect starts OAuth with deliveryOnDocuments in the body', async () => {
    await wizard.next().click();
    await expect(page.getByText('Delivery on documents').first()).toBeVisible();
    await page.getByRole('button', { name: 'Connect with Allegro' }).click();
    await expect.poll(() => requestBody).not.toBeNull();
    expect(requestBody).toHaveProperty('deliveryOnDocuments');
    expect(requestBody).toHaveProperty('connectionName', 'Delivery E2E wizard');
  });
});

test('Erli wizard: the suggested settings land in the created connection', async ({
  page,
  pages,
  api,
}) => {
  const wizard = pages.erliWizard;

  await test.step('credentials with a dummy key, then the Sales documents step', async () => {
    await wizard.goto();
    await wizard.fillCredentials(ERLI_NAME, 'delivery-e2e-dummy-key');
    await expect(wizard.step.suggestedChoice).toBeChecked();
  });

  await test.step('review and create the connection', async () => {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Connect Erli' }).click();
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step('the created connection carries the Polish delivery name', async () => {
    const created = (await api.connections.list()).find((c) => c.name === ERLI_NAME);
    expect(created, 'the Erli connection was created').toBeDefined();
    const delivery = (created?.config as Record<string, unknown>)['deliveryOnDocuments'] as {
      countries: Record<string, { name: string }>;
    };
    expect(delivery.countries['PL']?.name).toBe('Koszt dostawy');
  });
});
