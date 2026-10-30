/**
 * Mappings "Delivery on documents" tab, end to end (#3912, #3908, ADR-079)
 *
 * Walks the operator path on the seeded Allegro-like source: the first-run
 * suggestion strip, reviewing and adopting the Poland suggestion, adding a
 * country with an own-language name and a fixed rate, editing and removing it,
 * the header tooltip, the example receipt/invoice block, and persistence across
 * a reload. The saved config is read back from the API so the assertion is on
 * what reached persistence, not on what the page remembers - and the other
 * config keys on the connection must survive every save.
 *
 * @module tests/delivery-on-documents
 */
import { test, expect } from '../../src/fixtures/test';
import {
  DELIVERY_CONNECTION_IDS,
  cleanupDeliveryOnDocuments,
  seedDeliveryOnDocuments,
  setSourceDeliveryConfig,
} from '../../src/support/delivery-on-documents-seed';

test.beforeAll(async ({ api }) => {
  await seedDeliveryOnDocuments();
  await setSourceDeliveryConfig(api, null);
});

test.afterAll(async () => {
  await cleanupDeliveryOnDocuments();
});

test('the delivery tab: first run, suggestions, add / edit / remove a country, persistence', async ({
  page,
  pages,
  api,
}) => {
  const tab = pages.deliveryOnDocuments;

  await test.step('open the tab on a connection with no delivery settings', async () => {
    await tab.goto(DELIVERY_CONNECTION_IDS.source);
    await expect(tab.suggestionStrip).toContainText('Most of your orders go to Poland.');
  });

  await test.step('Review opens the editor prefilled "Suggested for Poland", Cancel closes it', async () => {
    await tab.button('Review').click();
    await expect(tab.editor.title('Poland')).toBeVisible();
    await expect(tab.editor.fillIn).toHaveValue('PL');
    await expect(tab.editor.fillIn.locator('option:checked')).toHaveText('Suggested for Poland');
    await tab.editor.button('Cancel').click();
    await expect(tab.editor.root).toBeHidden();
  });

  await test.step('"Use them" adds the Poland row with the rate in the name', async () => {
    await tab.button('Use them').click();
    await expect(tab.notice).toContainText('Poland saved.');
    await expect(tab.row('Poland')).toContainText('Koszt dostawy 23%');
    await expect(tab.suggestionStrip).toBeHidden();
  });

  await test.step('add Spain with a name of my own and a fixed 21% rate', async () => {
    await tab.button('+ Add a country').click();
    await expect(tab.editor.title('Add a country')).toBeVisible();
    await tab.editor.pickCountry('Spa', /Spain/);
    await tab.editor.typeOwnName('Envío');
    await tab.editor.rate.selectOption('fixed');
    await tab.editor.fixedRate.fill('21');
    await tab.editor.button('Add country').click();
    await expect(tab.notice).toContainText('Spain saved.');
    await expect(tab.row('Spain')).toContainText('Envío 21%');
  });

  await test.step('the saved config reaches the API and keeps the pairing key', async () => {
    const connection = await api.connections.getById(DELIVERY_CONNECTION_IDS.source);
    const config = connection.config as Record<string, unknown>;
    expect(config['masterCatalogConnectionId']).toBe(DELIVERY_CONNECTION_IDS.shop);
    const delivery = config['deliveryOnDocuments'] as {
      countries: Record<string, { name: string; rate: string; fixedRate?: string }>;
    };
    expect(delivery.countries['PL']?.name).toBe('Koszt dostawy');
    expect(delivery.countries['ES']).toMatchObject({ name: 'Envío', rate: 'fixed', fixedRate: '21' });
  });

  await test.step('the header tooltip explains the delivery line', async () => {
    await page.getByRole('button', { name: 'About delivery line' }).click();
    await expect(page.getByText('Why the rate is in the name')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  await test.step('the example block shows the Poland receipt with split delivery lines', async () => {
    await tab.exampleDetails.locator('summary').click();
    const receipt = tab.exampleDetails.locator('.dd-sample__col', { hasText: 'On the receipt' });
    await expect(receipt).toBeVisible();
    await expect(receipt.locator('.dd-sample__line')).toHaveCount(2);
    await expect(receipt).toContainText('Koszt dostawy 23%');
    await expect(receipt).toContainText('Koszt dostawy 5%');
  });

  await test.step('rows survive a reload', async () => {
    await tab.goto(DELIVERY_CONNECTION_IDS.source);
    await expect(tab.row('Poland')).toContainText('Koszt dostawy 23%');
    await expect(tab.row('Spain')).toContainText('Envío 21%');
  });

  await test.step('edit Spain, then remove it', async () => {
    await tab.editButton('Spain').click();
    await expect(tab.editor.title('Spain')).toBeVisible();
    await tab.editor.button('Remove Spain').click();
    await expect(tab.notice).toContainText('Spain removed.');
    await expect(tab.row('Spain')).toHaveCount(0);
    const connection = await api.connections.getById(DELIVERY_CONNECTION_IDS.source);
    const delivery = (connection.config as Record<string, unknown>)['deliveryOnDocuments'] as {
      countries: Record<string, unknown>;
    };
    expect(delivery.countries['ES']).toBeUndefined();
    expect(delivery.countries['PL']).toBeDefined();
  });
});
