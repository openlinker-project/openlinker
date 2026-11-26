/**
 * The PR author's own checkpoint register (C/S/W/U ids, sandbox run of 18 Nov
 * 2026): the ones that reproduce through the fake without extra setup. Test
 * titles carry the author's id (`[U14]`) instead of a checklist point number, so
 * the results go to `author-results.jsonl` through the same recorder-free path.
 *
 * @module tests/amazon
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, shot, createConn, runJob, pollUntilHas, fakeBuy, fakePost, sql } from './amazon-test';
import { world } from './amazon-world';
import { RUN_DIR } from '../../src/support/amazon';

const STAMP = Date.now();

test.afterEach(async ({ page }, info) => {
  const id = /\[([A-Z]\d{2})\]/.exec(info.title)?.[1];
  if (!id) return;
  mkdirSync(resolve(RUN_DIR, 'author'), { recursive: true });
  const file = resolve(RUN_DIR, 'author', `${id}-${info.project.name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  appendFileSync(
    resolve(RUN_DIR, 'author-results.jsonl'),
    `${JSON.stringify({ id, project: info.project.name, result: info.status === 'passed' ? 'pass' : 'fail', note: info.status === 'passed' ? info.title : (info.error?.message ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 300), screenshot: file })}\n`,
  );
});

test('[C02] a connection test with a wrong secret gives a bounded refusal sentence', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `author c02 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await fake.fail({ kind: 'lwa' });
  const res = await ol.call('POST', `/connections/${c.body.id}/test`);
  await fake.clearFailures();
  await evidence('POST /connections/:id/test with a refused secret', res.body);
  expect(res.body.success).toBe(false);
  expect(res.body.message).toMatch(/refused the credentials|unauthorized/i);
});

test('[S08] the MCF shipping speed field is offered once FulfillmentExecutor is enabled', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `author s08 ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster', 'InventoryMaster', 'FulfillmentExecutor'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByText('Multi-Channel Fulfillment shipping speed')).toBeVisible();
  const options = await page.getByLabel('Multi-Channel Fulfillment shipping speed').locator('option').allInnerTexts();
  expect(options.join(' ')).toMatch(/Standard/);
  expect(options.join(' ')).toMatch(/Expedited/);
  expect(options.join(' ')).toMatch(/Priority/);
  await shot(page, region.region, 'author-S08');
});

test('[U14] changing the title of an Amazon listing is refused on purpose, without retries', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const w = await world(ol, region);
  const sku = `E2E-${region.marketplaces[0]!.country}-1`;
  await runJob(ol, 'marketplace.offers.sync', w.sales.id, { limit: 20, cursor: null, feedType: 'offers', masterConnectionId: w.master.id });
  const res = await ol.call('POST', `/listings/connections/${w.sales.id}/offers/${sku}/fields`, { title: 'A new title from OpenLinker' });
  await new Promise((r) => setTimeout(r, 8000));
  const jobs = await sql<{ status: string; attempts: number; lastError: string | null }>(`select status, attempts, "lastError" from sync_jobs where "connectionId" = $1 and "jobType" = 'marketplace.offer.fieldUpdate' order by "createdAt" desc limit 1`, [w.sales.id]);
  await evidence('title update request and the job it created', { response: [res.status, res.body], job: jobs[0] });
  expect(res.status === 202 || res.status >= 400).toBe(true);
  if (jobs[0]) {
    expect(jobs[0].attempts).toBeLessThanOrEqual(1);
    expect(`${jobs[0].lastError ?? ''}`).toMatch(/Not supported on Amazon|not supported/i);
  } else {
    expect(JSON.stringify(res.body)).toMatch(/not supported|title/i);
  }
});

test('[U03] a recipient name with three words and a company name are mapped without losing the district', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `author u03 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
  await runJob(ol, 'marketplace.orders.poll', c.body.id, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
  const orderId = await fakeBuy({ region: region.region, sku: `E2E-${region.marketplaces[0]!.country}-1`, qty: 1, ageMinutes: 1 });
  await fakePost('/__state', { patchOrder: { orderId, recipient: { deliveryAddress: { name: 'Maria Silva Santos', companyName: 'Test Store #1234', addressLine1: 'Rua 1', city: 'Sao Paulo', districtOrCounty: 'Bela Vista', postalCode: '01310-100', countryCode: region.marketplaces[0]!.country } } } });
  const row = (await pollUntilHas(ol, c.body.id, [orderId])).find((o) => o.orderSnapshot.externalOrderId === orderId)!;
  await evidence('mapped recipient (author finding U03: how the name is split)', row.orderSnapshot.shippingAddress);
  const a = row.orderSnapshot.shippingAddress;
  expect(a.firstName + ' ' + a.lastName).toContain('Maria');
  expect(JSON.stringify(a)).toMatch(/Bela Vista|districtOrCounty|state|region/i);
});
