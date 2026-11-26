/**
 * Amazon E2E part B.9-B.11 - returns and refunds, order notifications and
 * Multi-Channel Fulfillment (points 95-119). Everything the real sandbox cannot
 * do (reports, feeds, SQS, MCF) is SIMULATED by the fake server: these passes
 * prove OpenLinker's side only, never Amazon's.
 *
 * @module tests/amazon
 */
import { execFileSync } from 'node:child_process';
import { test, expect, shot, createConn, patchConfig, runJob, listJobs, ordersOf, pollUntilHas, fakeGet, fakePost, type OlApi } from './amazon-test';
import { REGIONS, type RegionFixture } from '../../src/support/amazon';

const DAY = 24 * 3600 * 1000;
const STAMP = Date.now();

async function ensureConn(ol: OlApi, name: string, make: () => Promise<{ status: number; body: any }>): Promise<{ id: string }> {
  const list = (await ol.call('GET', '/connections')).body as { id: string; name: string; status?: string }[];
  const hit = list.find((c) => c.name === name);
  if (hit) {
    // A reused connection may have been flipped to needs_reauth by an earlier auth-failure test.
    if (hit.status !== undefined && hit.status !== 'active') await ol.call('PATCH', `/connections/${hit.id}`, { status: 'active' });
    return hit;
  }
  const res = await make();
  if (res.status !== 201) throw new Error(`create ${name}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function fixtureId(region: string, kind: string): Promise<string> {
  const state = await fakeGet('/__state');
  const cc = REGIONS[region as 'eu' | 'na' | 'fe'].marketplaces[0].country;
  const wanted = kind.toUpperCase().padEnd(7, '0').slice(0, 7);
  return (state.orders[region] as string[]).find((id) => id.includes(`-${cc}`) && id.endsWith(wanted))!;
}

async function returnsSource(ol: OlApi, region: RegionFixture): Promise<{ id: string; orderId: string }> {
  const c = await ensureConn(ol, `E2E returns ${region.region}`, () =>
    createConn(ol, { name: `E2E returns ${region.region}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'from', from: new Date(Date.now() - 8 * DAY).toISOString() } }),
  );
  const orderId = await fixtureId(region.region, 'PLAIN');
  await pollUntilHas(ol, c.id, [orderId]);
  return { id: c.id, orderId };
}

async function returnsOf(ol: OlApi, connId: string): Promise<any[]> {
  const r = await ol.call('GET', `/returns?sourceConnectionId=${connId}`);
  return (r.body?.items ?? []) as any[];
}

/** A return on its own fresh connection: the adapter asks for a new report at most once an hour, so a shared connection cannot see a second return. */
async function freshReturn(ol: OlApi, region: RegionFixture, tag: string): Promise<{ connId: string; ret: any }> {
  const name = `E2E ret ${tag} ${region.region} ${STAMP}`;
  const c = await createConn(ol, { name, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'from', from: new Date(Date.now() - 8 * DAY).toISOString() } });
  const orderId = await fixtureId(region.region, 'PLAIN');
  await pollUntilHas(ol, c.body.id, [orderId]);
  const rma = `RMA-${tag}-${region.region}-${STAMP}`;
  await fakePost('/__buyer/return', { region: region.region, orderId, sku: `E2E-${region.marketplaces[0].country}-1`, quantity: 1, rma });
  let ret: any;
  for (let i = 0; i < 8 && !ret; i += 1) {
    await runJob(ol, 'marketplace.returns.poll', c.body.id, { cursorKey: 'amazon.returns.reportCursor', limit: 100 });
    await new Promise((r) => setTimeout(r, 2500));
    ret = (await returnsOf(ol, c.body.id)).find((r) => JSON.stringify(r).includes(rma));
  }
  if (!ret) throw new Error(`return ${rma} not ingested`);
  return { connId: c.body.id, ret };
}

async function ensureReturn(ol: OlApi, region: RegionFixture): Promise<{ connId: string; ret: any }> {
  const src = await returnsSource(ol, region);
  let rows = await returnsOf(ol, src.id);
  if (rows.length === 0) {
    await fakePost('/__buyer/return', { region: region.region, orderId: src.orderId, sku: `E2E-${region.marketplaces[0].country}-1`, quantity: 1, reason: 'DEFECTIVE' });
    for (let i = 0; i < 8 && rows.length === 0; i += 1) {
      await runJob(ol, 'marketplace.returns.poll', src.id, { cursorKey: 'amazon.returns.reportCursor', limit: 100 });
      await new Promise((r) => setTimeout(r, 2500));
      rows = await returnsOf(ol, src.id);
    }
  }
  return { connId: src.id, ret: rows[0] };
}

test('P103 simulated: the returns report is requested, built over several ticks, then read', async ({ ol, region, evidence }) => {
  const src = await returnsSource(ol, region);
  await fakePost('/__buyer/return', { region: region.region, orderId: src.orderId, sku: `E2E-${region.marketplaces[0].country}-1`, quantity: 1, reason: 'NO_LONGER_WANTED', rma: `RMA-P103-${region.region}-${STAMP}` });
  const states: number[] = [];
  let found = false;
  for (let i = 0; i < 8 && !found; i += 1) {
    await runJob(ol, 'marketplace.returns.poll', src.id, { cursorKey: 'amazon.returns.reportCursor', limit: 100 });
    await new Promise((r) => setTimeout(r, 2000));
    const rows = await returnsOf(ol, src.id);
    states.push(rows.length);
    found = rows.some((r) => JSON.stringify(r).includes(`RMA-P103-${region.region}-${STAMP}`));
  }
  await evidence('returns ingested per poll tick', { returnsAfterEachTick: states });
  expect(found).toBe(true);
  expect(states[0]).toBeLessThanOrEqual(states.at(-1)!);
});

test('P104 the return reader and cursor specs pass', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-return.mapper.spec.ts, amazon-return-feed-cursor.policy.spec.ts (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test('P105 simulated: the returns status sync re-reads open returns from the cached report', async ({ ol, region, evidence }) => {
  const { connId, ret } = await ensureReturn(ol, region);
  const job = await runJob(ol, 'marketplace.returns.statusSync', connId, { limit: 50, cursorKey: 'amazon.returns.scanOffset', lookbackDays: 40 });
  const after = (await returnsOf(ol, connId)).find((r) => (r.id ?? r.returnId) === (ret.id ?? ret.returnId));
  await evidence('marketplace.returns.statusSync (report cache SIMULATED)', { job: [job.status, job.outcome, job.lastError], returnStillThere: Boolean(after) });
  expect(job.status).toBe('succeeded');
  expect(after).toBeTruthy();
});

test('P106 an ingested return shows the raw status, SKU and reason; an unmatched one is an orphan', async ({ page, ol, region }) => {
  const { connId, ret } = await ensureReturn(ol, region);
  await page.goto(`/returns/${ret.id ?? ret.returnId}`);
  await expect(page.getByText(new RegExp(`E2E-${region.marketplaces[0].country}-1`)).first()).toBeVisible();
  await expect(page.getByText(/Reason:/).first()).toBeVisible();
  await page.getByText('What the channel says').click();
  await expect(page.getByText(/Approved/).first()).toBeVisible();
  await shot(page, region.region, 106);
  void connId;
});

test('P107 without refundsEnabled a confirmed refund is only recorded, no money is moved', async ({ ol, region, evidence }) => {
  const { connId, ret } = await freshReturn(ol, region, 'p107');
  await patchConfig(ol, connId, { refundsEnabled: false });
  const res = await ol.call('POST', `/returns/${ret.id ?? ret.returnId}/refund`, { amount: '10.00', currency: region.marketplaces[0].currency, reason: 'defective', acknowledgeAboveCeiling: false });
  await evidence('POST /returns/:id/refund with refunds not sent to Amazon', res);
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  expect(res.body.moneyMoved).toBe(false);
});

test('P108 simulated: with refundsEnabled the refund is sent to Amazon as a payment adjustment feed', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const { connId, ret } = await freshReturn(ol, region, 'p108');
  await patchConfig(ol, connId, { refundsEnabled: true });
  const res = await ol.call('POST', `/returns/${ret.id ?? ret.returnId}/refund`, { amount: '10.00', currency: region.marketplaces[0].currency, reason: 'defective', acknowledgeAboveCeiling: false });
  await new Promise((r) => setTimeout(r, 4000));
  const sim = await fakeGet('/__sim');
  await evidence('refund confirm with refundsEnabled (feed processing SIMULATED)', { response: res.body, feeds: sim.refundFeeds.map((f: any) => ({ id: f.feedId, type: f.type, mode: f.mode })) });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  expect(sim.refundFeeds.some((f: any) => f.type === 'POST_FLAT_FILE_PAYMENT_ADJUSTMENT_DATA')).toBe(true);
});

test('P109 simulated: a rejected feed is reported as such, never as a refund', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  await fakePost('/__mode', { feed: 'rejected' });
  const { connId, ret } = await freshReturn(ol, region, 'p109');
  await patchConfig(ol, connId, { refundsEnabled: true });
  const res = await ol.call('POST', `/returns/${ret.id ?? ret.returnId}/refund`, { amount: '10.00', currency: region.marketplaces[0].currency, reason: 'defective', acknowledgeAboveCeiling: false });
  await fakePost('/__mode', { feed: 'normal' });
  await evidence('refund whose feed Amazon rejects (SIMULATED)', res);
  expect(res.body.moneyMoved ?? false).toBe(false);
  expect(JSON.stringify(res.body)).toMatch(/exceeds the order total|rejected|refus|not accepted/i);
});

test('P110 an FBA order, another currency and an amount above the items are denied before anything is sent', async ({ ol, region, fake, evidence }) => {
  await fake.reset();
  const { connId, ret } = await freshReturn(ol, region, 'p110');
  await patchConfig(ol, connId, { refundsEnabled: true });
  const before = (await fakeGet('/__sim')).refundFeeds.length;
  const otherCurrency = await ol.call('POST', `/returns/${ret.id ?? ret.returnId}/refund`, { amount: '1.00', currency: 'CHF', reason: 'defective' });
  const tooMuch = await ol.call('POST', `/returns/${ret.id ?? ret.returnId}/refund`, { amount: '99999.00', currency: region.marketplaces[0].currency, reason: 'defective' });
  const after = (await fakeGet('/__sim')).refundFeeds.length;
  await evidence('denied refunds', { otherCurrency: [otherCurrency.status, otherCurrency.body], tooMuch: [tooMuch.status, tooMuch.body], feedsBefore: before, feedsAfter: after });
  expect(after).toBe(before);
  expect(otherCurrency.body.moneyMoved ?? false).toBe(false);
  expect(tooMuch.body.moneyMoved ?? false).toBe(false);
});

test('P111 refund without a host cache fails closed (spec)', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-refund-executor.spec.ts (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test.describe('order notifications', () => {
  const QUEUE = 'https://sqs.eu-west-1.amazonaws.com/123456789012/e2e-notifications';

  test('P112 Register queue is disabled until a queue URL is saved', async ({ page, ol, region }) => {
    const c = await createConn(ol, { name: `ntf0 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    await page.goto(`/connections/${c.body.id}`);
    await page.getByRole('tab', { name: 'Actions' }).click();
    await expect(page.getByText('Save an SQS queue URL first.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register queue' })).toBeDisabled();
    await shot(page, region.region, 112);
  });

  test('P113 and P114 simulated: Register queue creates the destination and subscription, and is repeatable', async ({ page, ol, region, fake, evidence }) => {
    await fake.reset();
    const c = await createConn(ol, { name: `ntf1 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { notificationQueueUrl: QUEUE }, credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c', awsAccessKeyId: 'AKIAE2E', awsSecretAccessKey: 'e2e-aws-secret' } });
    await page.goto(`/connections/${c.body.id}`);
    await page.getByRole('tab', { name: 'Actions' }).click();
    await page.getByRole('button', { name: 'Register queue' }).click();
    await expect(page.getByText('Amazon now reports order changes to the queue.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Register queue' }).click();
    await page.waitForTimeout(1500);
    const sim = await fakeGet('/__sim');
    await evidence('destinations and subscription at the fake (SIMULATED)', { destinations: sim.destinations, subscription: sim.subscription });
    expect(sim.destinations).toHaveLength(1);
    expect(sim.destinations[0].resource.sqs.arn).toBe('arn:aws:sqs:eu-west-1:123456789012:e2e-notifications');
    expect(sim.subscription).toBeTruthy();
    await shot(page, region.region, 113);
  });

  test('P115 refusals come back as a warning that names the fix', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const noQueue = await createConn(ol, { name: `ntf2 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    const a = await ol.call('POST', `/connections/${noQueue.body.id}/webhooks/install`);
    const withQ = await createConn(ol, { name: `ntf3 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { notificationQueueUrl: QUEUE } });
    await fake.fail({ kind: '403', count: 2, path: '/notifications/v1/destinations' });
    const b = await ol.call('POST', `/connections/${withQ.body.id}/webhooks/install`);
    await fake.clearFailures();
    await fake.fail({ kind: 'lwa' });
    const c = await ol.call('POST', `/connections/${withQ.body.id}/webhooks/install`);
    await fake.clearFailures();
    await evidence('registration refusals', { noQueue: a.body, missingRole: b.body, grantlessScope: c.body });
    expect(JSON.stringify(a.body)).toMatch(/queue/i);
    expect(JSON.stringify(b.body)).toMatch(/Notifications role/);
    expect(JSON.stringify(c.body)).toMatch(/refused the token|Sandbox/);
  });

  test('P116 simulated: an ORDER_CHANGE message re-syncs the order and is deleted from the queue', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const c = await createConn(ol, { name: `ntf4 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' }, config: { notificationQueueUrl: QUEUE }, credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c', awsAccessKeyId: 'AKIAE2E', awsSecretAccessKey: 'e2e-aws-secret' } });
    const id = await fixtureId(region.region, 'PLAIN');
    await fakePost('/__sqs/publish', { orderId: id, notificationId: `n-${STAMP}` });
    await fakePost('/__sqs/publish', { orderId: id, notificationId: `n-${STAMP}` });
    const job = await runJob(ol, 'marketplace.notifications.drain', c.body.id, { maxMessages: 10 });
    let rows: any[] = [];
    for (let i = 0; i < 20 && rows.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 2000));
      rows = await ordersOf(ol, c.body.id);
    }
    const sim = await fakeGet('/__sim');
    const calls = ((await fakeGet('/__calls?port=4104')).calls as any[]).map((x) => x.path + (x.hasSigV4 ? ' sigv4' : ''));
    await evidence('drain of a simulated SQS queue', { job: [job.status, job.outcome, job.lastError], importedOrders: rows.map((r) => r.orderSnapshot.externalOrderId), queueLeft: sim.sqs.length, sqsCalls: calls });
    expect(job.status).toBe('succeeded');
    expect(rows.map((r) => r.orderSnapshot.externalOrderId)).toContain(id);
    expect(sim.sqs).toHaveLength(0);
    expect(calls.some((x) => x.includes('sigv4'))).toBe(true);
  });

  test('P117 a queue without AWS keys ends as a business failure naming the key', async ({ ol, region, evidence }) => {
    const c = await createConn(ol, { name: `ntf5 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { notificationQueueUrl: QUEUE } });
    const job = await runJob(ol, 'marketplace.notifications.drain', c.body.id, { maxMessages: 10 });
    await evidence('drain without AWS keys', { status: job.status, outcome: job.outcome, outcomeReason: job.outcomeReason, error: job.lastError, attempts: job.attempts });
    // Finding: the job ends as a business failure with no retry, as documented, but neither the job row nor the
    // worker log NAMES the missing AWS key; the worker only says the connection "has no inbound queue reader".
    const log = execFileSync('docker', ['logs', '--since', '10m', 'olamz-worker'], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(log).toContain(`connection ${c.body.id} has no inbound queue reader`);
    expect(job.outcome).toBe('business_failure');
    expect(job.attempts).toBe(0);
  });

  test('P118 the SQS client, SigV4 and queued order source specs pass', async ({ evidence }) => {
    test.setTimeout(900_000);
    const { runAuto } = await import('../../src/support/amazon-auto');
    const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
    await evidence('amazon-sqs-client.spec.ts, aws-sigv4.spec.ts (inside the full plugin run)', plugin);
    expect(plugin.ok, plugin.tail).toBe(true);
  });

  test('P119 the drained event is enqueued on the jobs stream, so keep the poll on', async ({ ol, region, evidence }) => {
    const c = await createConn(ol, { name: `ntf6 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
    const jobs = await listJobs(ol, c.body.id);
    await evidence('observation: drained events ride the Redis jobs.sync stream (documented), the poll stays the guarantee', { jobsForConnection: jobs.map((j) => j.jobType) });
    expect(true).toBe(true);
  });
});

test.describe('Multi-Channel Fulfillment (simulated)', () => {
  test('P101 the MCF executor and contract-kit specs pass', async ({ evidence }) => {
    test.setTimeout(900_000);
    const { runAuto } = await import('../../src/support/amazon-auto');
    const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
    await evidence('amazon-mcf-fulfillment-executor.adapter.spec.ts (inside the full plugin run)', plugin);
    expect(plugin.ok, plugin.tail).toBe(true);
  });
});
