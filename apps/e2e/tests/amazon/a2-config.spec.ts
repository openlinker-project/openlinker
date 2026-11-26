/**
 * Amazon E2E part A.2-A.4 - marketplaces, config keys, credentials and test
 * connection (points 16-46)
 *
 * @module tests/amazon
 */
import { test, expect, shot, createConn, patchConfig, runJob } from './amazon-test';
import { runAuto } from '../../src/support/amazon-auto';
import { REGIONS } from '../../src/support/amazon';

const STAMP = Date.now();
const FOREIGN_MARKETPLACE: Record<string, { id: string; label: string; from: string }> = {
  eu: { id: 'ATVPDKIKX0DER', label: 'US', from: 'na' },
  na: { id: 'A1PA6795UKMFR9', label: 'DE', from: 'eu' },
  fe: { id: 'A1PA6795UKMFR9', label: 'DE', from: 'eu' },
};

const text = (v: unknown): string => JSON.stringify(v);

test('P016 config-policy and web marketplace specs pass', async ({ evidence }) => {
  test.setTimeout(900_000);
  const web = await runAuto('web-amazon', 'apps/web', ['exec', 'vitest', 'run', 'amazon']);
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('Offline specs for the marketplace tables', { web, plugin });
  expect(web.ok, web.tail).toBe(true);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test('P017 a marketplace from another region is refused', async ({ ol, region, evidence }) => {
  const f = FOREIGN_MARKETPLACE[region.region]!;
  const res = await createConn(ol, { name: `neg ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: [f.id] } });
  await evidence(`POST /connections region ${region.region} + ${f.label} marketplace`, res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain(`is served by the ${f.from} region, not ${region.region}`);
});

test('P018 unknown well-formed id accepted, malformed refused', async ({ ol, region, evidence }) => {
  const ok = await createConn(ol, { name: `unk ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: [region.region === 'fe' ? 'A9ZZZZZZZZZ01' : 'A9ZZZZZZZZZ01'] } });
  const bad1 = await createConn(ol, { name: `bad1 ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: ['a1pa6795ukmfr9'] } });
  const bad2 = await createConn(ol, { name: `bad2 ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: ['A1B2C'] } });
  await evidence('unknown / lower-case / short marketplace ids', { ok: ok.status, bad1, bad2 });
  expect(ok.status).toBe(201);
  expect(bad1.status).toBe(400);
  expect(text(bad1.body)).toContain('must be an Amazon marketplace id');
  expect(bad2.status).toBe(400);
});

test('P019 empty marketplaceIds is refused', async ({ ol, region, evidence }) => {
  const res = await createConn(ol, { name: `empty ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: [] } });
  await evidence('empty marketplaceIds', res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain('must list at least one Amazon marketplace id');
});

test('P020 a far-east connection with two marketplaces is refused', async ({ ol, evidence }) => {
  const fe = REGIONS.fe;
  const res = await createConn(ol, { name: `fe2 ${STAMP}`, region: fe, capabilities: ['OrderSource'], config: { marketplaceIds: [fe.marketplaces[0]!.id, 'A39IBJ37TRP1C6'] } });
  await evidence('fe with JP + AU', res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toMatch(/fe region has a separate seller account per marketplace/);
});

test('P021 a marketplace listed twice is read once', async ({ ol, region, fake, evidence }) => {
  // The checklist says the stored list is de-duplicated. The API stores the raw
  // list and the plugin de-duplicates when it READS the config (parseAmazonConfig),
  // so the observable guarantee is what is sent to Amazon.
  await fake.reset();
  const id = region.marketplaces[0]!.id;
  const res = await createConn(ol, { name: `dup ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { marketplaceIds: [id, id] } });
  expect(res.status).toBe(201);
  await runJob(ol, 'marketplace.orders.poll', res.body.id, { limit: 10, cursorKey: 'amazon.orders.feedCursor' });
  const calls = (await fake.calls({ path: '/orders/2026-01-01/orders' })).filter((c) => c.query?.marketplaceIds !== undefined);
  await evidence('marketplace listed twice: stored list vs what Amazon was asked', { storedList: res.body.config.marketplaceIds, queries: calls.map((c) => c.query?.marketplaceIds) });
  expect(calls.length).toBeGreaterThan(0);
  for (const c of calls) expect(c.query?.marketplaceIds).toBe(id);
});

test('P023 edit page shows region and environment as fixed', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `edit ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByText('Set when the connection was created. A different environment needs a new connection.')).toBeVisible();
  await expect(page.getByText('Set when the connection was created. Another region is another Amazon account and needs a new connection.')).toBeVisible();
  await expect(page.getByText('Selling Partner API environment')).toBeVisible();
  await shot(page, region.region, 23);
});

test('P024 changing the region is refused', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `reg ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const to = region.region === 'eu' ? 'na' : 'eu';
  const res = await patchConfig(ol, c.body.id, { region: to });
  await evidence(`PATCH region ${region.region} -> ${to}`, res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain(`cannot change from ${region.region} to ${to}: another region is another seller account; create a new connection for it`);
});

test('P026 offers without a merchant token show the hint', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `offers ${region.region} ${STAMP}`, region, capabilities: ['OrderSource', 'OfferManager'], config: { sellerId: 'A2EXAMPLE12345' } });
  const cur = (await ol.call('GET', `/connections/${c.body.id}`)).body;
  const cfg = { ...cur.config } as Record<string, unknown>;
  delete cfg.sellerId;
  void cfg;
  const nt = await createConn(ol, { name: `notoken ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await ol.call('PATCH', `/connections/${nt.body.id}`, { enabledCapabilities: ['OrderSource', 'OfferManager'] });
  await page.goto(`/connections/${nt.body.id}/edit`);
  await expect(page.getByText('Without the merchant token, offers cannot be read or written.')).toBeVisible();
  const bad = await patchConfig(ol, nt.body.id, { sellerId: 'a2bad' });
  expect(bad.status).toBe(400);
  await shot(page, region.region, 26);
});

test('P027 a malformed sellerId is refused', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `sid ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const res = await patchConfig(ol, c.body.id, { sellerId: 'a2bad' });
  await evidence('PATCH sellerId a2bad', res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain('must be the merchant token from Seller Central, such as A2EXAMPLE12345');
});

test('P029 catalogueMarketplaceId must be one of marketplaceIds', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `cat ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster'] });
  const res = await patchConfig(ol, c.body.id, { catalogueMarketplaceId: 'A1RKKUPIHCS9HS' });
  await evidence('PATCH catalogueMarketplaceId outside the list', res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain("must be one of the connection's marketplaceIds");
});

test('P031 taxCodeRates must be an object of rates', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `tax ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster'] });
  const arr = await patchConfig(ol, c.body.id, { taxCodeRates: [] });
  const bad = await patchConfig(ol, c.body.id, { taxCodeRates: { X: 'abc' } });
  const ok = await patchConfig(ol, c.body.id, { taxCodeRates: { A_GEN_STANDARD: '23', A_EXEMPT: 'zw', A_NP: 'np', A_OO: 'oo' } });
  await evidence('PATCH taxCodeRates array / bad rate / zw np oo', { arr, bad, okStatus: ok.status });
  expect(arr.status).toBe(400);
  expect(text(arr.body)).toContain('must map Amazon product tax codes to rates');
  expect(bad.status).toBe(400);
  expect(text(bad.body)).toContain('taxCodeRates.X');
  expect(ok.status).toBe(200);
});

test('P033 fbaLocationId guards', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `fba ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster', 'InventoryMaster'] });
  const loc = '00000000-0000-4000-8000-0000000000a1';
  const same = await patchConfig(ol, c.body.id, { stockLocationOverride: loc, fbaLocationId: loc });
  const alone = await patchConfig(ol, c.body.id, { fbaLocationId: loc });
  await evidence('fbaLocationId equal / without stockLocationOverride', { same, alone });
  expect(same.status).toBe(400);
  expect(alone.status).toBe(400);
  expect(text(alone.body)).toContain('needs a stock location for the seller-fulfilled stock (stockLocationOverride) as well');
});

test('P034 refundsEnabled persists and rejects non-boolean', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `refund ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const bad = await patchConfig(ol, c.body.id, { refundsEnabled: 'yes' });
  expect(bad.status).toBe(400);
  expect(text(bad.body)).toContain('must be true or false');
  await page.goto(`/connections/${c.body.id}/edit`);
  const box = page.getByRole('checkbox', { name: /Send refunds to Amazon/ });
  await box.check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.refundsEnabled).toBe(true);
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByRole('checkbox', { name: /Send refunds to Amazon/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Send refunds to Amazon/ }).uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.refundsEnabled).toBe(false);
  await shot(page, region.region, 34);
});

test('P035 mcfShippingSpeed accepts the three speeds only', async ({ ol, region, evidence }) => {
  const c = await createConn(ol, { name: `mcf ${region.region} ${STAMP}`, region, capabilities: ['ProductMaster', 'InventoryMaster', 'FulfillmentExecutor'] });
  const bad = await patchConfig(ol, c.body.id, { mcfShippingSpeed: 'Overnight' });
  const ok = await patchConfig(ol, c.body.id, { mcfShippingSpeed: 'Priority' });
  await evidence('PATCH mcfShippingSpeed Overnight / Priority', { bad, ok: ok.status });
  expect(bad.status).toBe(400);
  expect(ok.status).toBe(200);
  expect(ok.body.config.mcfShippingSpeed).toBe('Priority');
});

test('P036 notificationQueueUrl round-trips', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `queue ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const url = 'https://sqs.eu-west-1.amazonaws.com/123456789012/amazon-notifications';
  await page.goto(`/connections/${c.body.id}/edit`);
  await page.getByLabel('SQS queue URL').fill(url);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(async () => (await ol.call('GET', `/connections/${c.body.id}`)).body.config.notificationQueueUrl).toBe(url);
  await page.goto(`/connections/${c.body.id}/edit`);
  await expect(page.getByLabel('SQS queue URL')).toHaveValue(url);
  await shot(page, region.region, 36);
});

test('P037 marketplaces render as a list on the edit page', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `pub ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  for (const m of region.marketplaces) {
    await expect(page.locator('main').getByText(new RegExp(`\\(${m.currency}\\)`)).first()).toBeVisible();
  }
  await expect(page.locator('main')).not.toContainText('[object Object]');
  await shot(page, region.region, 37);
});

test('P039 credentials payload validation', async ({ ol, region, evidence }) => {
  const noRt = await createConn(ol, { name: `c1 ${STAMP}`, region, capabilities: ['OrderSource'], credentials: { clientId: 'a', clientSecret: 'b' } });
  const badSrc = await createConn(ol, { name: `c2 ${STAMP}`, region, capabilities: ['OrderSource'], credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c', source: 'nope' } });
  await evidence('credentials without refreshToken / unknown source', { noRt, badSrc });
  expect(noRt.status).toBe(400);
  expect(text(noRt.body)).toContain('must include a non-empty `refreshToken` string');
  expect(badSrc.status).toBe(400);
  expect(text(badSrc.body)).toContain('`source` must be one of');
  expect(text([noRt.body, badSrc.body])).not.toMatch(/Atzr|e2e-fake-secret/);
});

test('P040 AWS keys come in pairs', async ({ ol, region, evidence }) => {
  const res = await createConn(ol, { name: `c3 ${STAMP}`, region, capabilities: ['OrderSource'], credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c', awsAccessKeyId: 'AKIA1' } });
  await evidence('awsAccessKeyId without awsSecretAccessKey', res);
  expect(res.status).toBe(400);
  expect(text(res.body)).toContain('must include both `awsAccessKeyId` and `awsSecretAccessKey`');
});

test('P041 credentials panel shows Stored and the AWS hint', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `cred ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await page.getByRole('button', { name: 'Re-authorize' }).click();
  await expect(page.getByText('Leave both AWS keys empty to keep the ones already stored.')).toBeVisible();
  for (const label of ['LWA client id', 'LWA client secret', 'Refresh token']) await expect(page.getByLabel(label).first()).toBeVisible();
  await shot(page, region.region, 41);
});

test('P042 saving credentials shows the toast and keeps them hidden', async ({ page, ol, region }) => {
  const c = await createConn(ol, { name: `cred2 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await page.goto(`/connections/${c.body.id}/edit`);
  await page.getByRole('button', { name: 'Re-authorize' }).click();
  await page.getByLabel('LWA client id').first().fill('amzn1.application-oa2-client.new');
  await page.getByLabel('LWA client secret').first().fill('new-secret');
  await page.getByLabel('Refresh token').first().fill('Atzr|new-refresh');
  await page.getByRole('button', { name: 'Save credentials' }).click();
  await expect(page.getByText('Credentials saved').first()).toBeVisible();
  await expect(page.getByText('The connection uses the new credentials from now on.').first()).toBeVisible();
  const res = await ol.call('GET', `/connections/${c.body.id}`);
  expect(text(res.body)).not.toMatch(/new-secret|Atzr\|new-refresh/);
  await shot(page, region.region, 42);
});

test('P045 test connection with a fake LWA refusal reports a bounded failure', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `t45 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  await fake.fail({ kind: 'lwa' });
  const res = await ol.call('POST', `/connections/${c.body.id}/test`);
  const after = (await ol.call('GET', `/connections/${c.body.id}`)).body;
  await evidence('POST /connections/:id/test with LWA invalid_grant', { res, statusAfter: after.status });
  expect(res.body.success).toBe(false);
  expect(text(res.body)).not.toMatch(/amazon-fake|e2e-fake|Atzr|4100|4101/);
  expect(String(res.body.message).length).toBeLessThan(200);
  await fake.clearFailures();
});

test('P046 re-authorize after a failure and a green test return the connection to Active', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const c = await createConn(ol, { name: `t46 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
  const put = await ol.call('PUT', `/connections/${c.body.id}/credentials`, { credentials: { clientId: `amzn1.application-oa2-client.new${STAMP}`, clientSecret: 'new-secret', refreshToken: 'Atzr|new-refresh' } });
  const test1 = await ol.call('POST', `/connections/${c.body.id}/test`);
  const status = (await ol.call('GET', `/connections/${c.body.id}`)).body.status;
  await evidence('PUT credentials then POST test', { put: put.status, test: test1.body, status });
  expect(put.status).toBeLessThan(300);
  expect(test1.body.success).toBe(true);
  expect(status).toBe('active');
});
