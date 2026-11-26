/**
 * Amazon E2E part C - scheduler, roles and failure behaviour (points 120-140)
 *
 * @module tests/amazon
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, shot, createConn, runJob, listJobs, sql, fakeGet, type OlApi } from './amazon-test';
import { provisionRoleUser } from './roles';
import { resolveEnv } from '../../src/config/env';
import { OlApi as OlApiClass } from './amazon-test';

const STAMP = Date.now();
const TASKS = {
  orders: 'marketplace.orders.poll',
  returnsPoll: 'marketplace.returns.poll',
  returnsSync: 'marketplace.returns.statusSync',
  drain: 'marketplace.notifications.drain',
  offersSync: 'marketplace.offers.sync',
  offerStatus: 'marketplace.offer.statusSync',
} as const;

async function jobsSince(ol: OlApi, id: string, type: string, since: number): Promise<any[]> {
  return (await listJobs(ol, id, type)).filter((j) => Date.parse((j as any).createdAt) >= since);
}

test('P120 the six tasks are off unless their variables are set (spec)', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-scheduler-tasks.spec.ts: enabledDefault false for every task (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test.describe('scheduler ticks (every task ON on this stack, slow ones every minute)', () => {
  test('P121-P124 each task enqueues its job with the documented payload for the right connections', async ({ ol, region, evidence }) => {
    test.setTimeout(480_000);
    const start = Date.now();
    const sales = await createConn(ol, { name: `sch sales ${region.region} ${STAMP}`, region, capabilities: ['OrderSource', 'OfferManager'], config: { sellerId: 'A2EXAMPLE12345' }, orderSyncStart: { mode: 'now' } });
    const nosid = await createConn(ol, { name: `sch nosid ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    await ol.call('PATCH', `/connections/${nosid.body.id}`, { enabledCapabilities: ['OrderSource', 'OfferManager'] });
    const queued = await createConn(ol, { name: `sch queue ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/e2e-queue' }, credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c', awsAccessKeyId: 'AKIAE2E', awsSecretAccessKey: 'e2e-aws-secret' } });
    const seen: Record<string, any> = {};
    for (let i = 0; i < 70; i += 1) {
      await new Promise((r) => setTimeout(r, 5000));
      const o = await jobsSince(ol, sales.body.id, TASKS.orders, start);
      const rp = await jobsSince(ol, sales.body.id, TASKS.returnsPoll, start);
      const rs = await jobsSince(ol, sales.body.id, TASKS.returnsSync, start);
      const os = await jobsSince(ol, sales.body.id, TASKS.offersSync, start);
      const ost = await jobsSince(ol, sales.body.id, TASKS.offerStatus, start);
      const dr = await jobsSince(ol, queued.body.id, TASKS.drain, start);
      Object.assign(seen, { orders: o[0], returnsPoll: rp[0], returnsSync: rs[0], offersSync: os[0], offerStatus: ost[0], drain: dr[0] });
      if (Object.values(seen).every(Boolean)) break;
    }
    const noOffers = await jobsSince(ol, nosid.body.id, TASKS.offersSync, start);
    const noDrain = await jobsSince(ol, sales.body.id, TASKS.drain, start);
    await evidence('first job of each task for the test connections', { seen: Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v && { key: v.idempotencyKey, payload: v.payloadJson }])), offersJobsForConnectionWithoutSellerId: noOffers.length, drainJobsForConnectionWithoutQueue: noDrain.length });
    expect(seen.orders?.idempotencyKey).toMatch(new RegExp(`^marketplace:${sales.body.id}:orders:poll:`));
    expect(seen.orders.payloadJson).toMatchObject({ limit: 100, cursorKey: 'amazon.orders.feedCursor' });
    expect(seen.returnsPoll?.idempotencyKey).toMatch(/:returns:poll:/);
    expect(seen.returnsSync?.idempotencyKey).toMatch(/:returns:status:sync:/);
    expect(seen.offersSync?.payloadJson).toMatchObject({ limit: 20 });
    expect(seen.offerStatus?.idempotencyKey).toMatch(/:offer:status:sync:/);
    expect(seen.drain?.payloadJson).toMatchObject({ maxMessages: 10 });
    expect(noOffers).toHaveLength(0);
    expect(noDrain).toHaveLength(0);
  });

  test('P125 a disabled connection gets no job from any task', async ({ ol, region, evidence }) => {
    test.setTimeout(240_000);
    const c = await createConn(ol, { name: `sch off ${region.region} ${STAMP}`, region, capabilities: ['OrderSource', 'OfferManager'], config: { sellerId: 'A2EXAMPLE12345' } });
    const off = await ol.call('PATCH', `/connections/${c.body.id}/disable`);
    const since = Date.now();
    await new Promise((r) => setTimeout(r, 130_000));
    const counts: Record<string, number> = {};
    for (const [k, t] of Object.entries(TASKS)) counts[k] = (await jobsSince(ol, c.body.id, t, since)).length;
    await evidence('jobs created after the connection was disabled', { disable: off.status, counts });
    expect(off.status).toBeLessThan(300);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

test('P126 the scheduler task specs pass', async ({ evidence }) => {
  test.setTimeout(900_000);
  const { runAuto } = await import('../../src/support/amazon-auto');
  const plugin = await runAuto('plugin-amazon', '.', ['pnpm --filter @openlinker/integrations-amazon test'], 'docker');
  await evidence('amazon-scheduler-tasks.spec.ts (inside the full plugin run)', plugin);
  expect(plugin.ok, plugin.tail).toBe(true);
});

test('P127 the worker .env.example documents all six variables', async ({ evidence }) => {
  const text = readFileSync(resolve(__dirname, '../../../worker/.env.example'), 'utf8');
  const names = ['ORDERS_POLL', 'RETURNS_POLL', 'RETURNS_STATUS_SYNC', 'NOTIFICATIONS_DRAIN', 'OFFERS_SYNC', 'OFFER_STATUS_SYNC'].map((n) => `OL_AMAZON_${n}_SCHEDULER_ENABLED`);
  await evidence('apps/worker/.env.example', Object.fromEntries(names.map((n) => [n, text.includes(n)])));
  for (const n of names) expect(text, n).toContain(n);
});

test.describe('roles', () => {
  test('P128 an admin creates, edits, tests and re-authorizes', async ({ ol, region, evidence }) => {
    const c = await createConn(ol, { name: `role admin ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    const patch = await ol.call('PATCH', `/connections/${c.body.id}`, { name: `role admin ${region.region} ${STAMP} b` });
    const test1 = await ol.call('POST', `/connections/${c.body.id}/test`);
    const creds = await ol.call('PUT', `/connections/${c.body.id}/credentials`, { credentials: { clientId: 'a', clientSecret: 'b', refreshToken: 'c' } });
    await evidence('admin actions', { create: c.status, patch: patch.status, test: test1.status, credentials: creds.status });
    for (const s of [c.status, patch.status, test1.status, creds.status]) expect(s).toBeLessThan(300);
  });

  test('P129 an operator sees controls that match what the API accepts', async ({ browser, ol, region }) => {
    const env = resolveEnv();
    const c = await createConn(ol, { name: `role op ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], config: { notificationQueueUrl: 'https://sqs.eu-west-1.amazonaws.com/123456789012/e2e-queue' } });
    const op = await provisionRoleUser(env, ol, 'operator');
    const opApi = await new OlApiClass(env.apiUrl, op.username, op.password).login();
    const apiPatch = await opApi.call('PATCH', `/connections/${c.body.id}`, { name: 'x' });
    const apiTest = await opApi.call('POST', `/connections/${c.body.id}/test`);
    const apiInstall = await opApi.call('POST', `/connections/${c.body.id}/webhooks/install`);
    const ctx = await browser.newContext();
    await ctx.request.post(`${env.apiUrl}/v1/auth/login`, { data: { username: op.username, password: op.password } });
    const page = await ctx.newPage();
    await page.addInitScript(() => window.localStorage.setItem('openlinker.locale', 'en'));
    await page.goto(`/connections/${c.body.id}/edit`);
    await page.waitForLoadState('networkidle');
    const saveVisible = await page.getByRole('button', { name: 'Save changes' }).isVisible().catch(() => false);
    await page.goto(`/connections/${c.body.id}`);
    await page.getByRole('tab', { name: 'Actions' }).click().catch(() => undefined);
    await page.waitForTimeout(1500);
    const registerVisible = await page.getByRole('button', { name: 'Register queue' }).isVisible().catch(() => false);
    const testVisible = await page.getByRole('button', { name: /Test connection/ }).first().isVisible().catch(() => false);
    await shot(page, region.region, 129);
    await ctx.close();
    // The API refuses every connection write for an operator, so no such control may be offered.
    expect([apiPatch.status, apiTest.status, apiInstall.status]).toEqual([403, 403, 403]);
    expect({ saveVisible, registerVisible, testVisible }).toEqual({ saveVisible: false, registerVisible: false, testVisible: false });
  });

  test('P130 a viewer reads everywhere and sees no write control', async ({ browser, ol, region }) => {
    const env = resolveEnv();
    const c = await createConn(ol, { name: `role viewer ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    const viewer = await provisionRoleUser(env, ol, 'viewer');
    const ctx = await browser.newContext();
    await ctx.request.post(`${env.apiUrl}/v1/auth/login`, { data: { username: viewer.username, password: viewer.password } });
    const page = await ctx.newPage();
    await page.addInitScript(() => window.localStorage.setItem('openlinker.locale', 'en'));
    for (const path of ['/connections', `/connections/${c.body.id}`, '/orders', '/returns']) {
      const r = await page.goto(path);
      expect(r?.status() ?? 200).toBeLessThan(400);
      await page.waitForLoadState('networkidle');
    }
    await page.goto(`/connections/${c.body.id}`);
    await page.waitForLoadState('networkidle');
    for (const name of [/Test connection/, /Register queue/, /Save changes/, /Create connection/]) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    await page.goto('/connections/new/amazon');
    await expect(page.getByText('Read-only access')).toBeVisible();
    await shot(page, region.region, 130);
    await ctx.close();
  });

  test('P131 a viewer cannot patch a connection or install webhooks', async ({ ol, region, evidence }) => {
    const env = resolveEnv();
    const c = await createConn(ol, { name: `role v2 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'] });
    const viewer = await provisionRoleUser(env, ol, 'viewer');
    const v = await new OlApiClass(env.apiUrl, viewer.username, viewer.password).login();
    const p = await v.call('PATCH', `/connections/${c.body.id}`, { name: 'x' });
    const i = await v.call('POST', `/connections/${c.body.id}/webhooks/install`);
    await evidence('viewer writes', { patch: p.status, install: i.status });
    expect([p.status, i.status]).toEqual([403, 403]);
  });

  test('P132 no response carries a credential', async ({ ol, region, evidence }) => {
    const env = resolveEnv();
    const c = await createConn(ol, { name: `role v3 ${region.region} ${STAMP}`, region, capabilities: ['OrderSource'], credentials: { clientId: 'cid-e2e-visible-no', clientSecret: 'secret-e2e-visible-no', refreshToken: 'Atzr|refresh-e2e-visible-no', awsAccessKeyId: 'AKIAE2EVISIBLENO', awsSecretAccessKey: 'aws-secret-e2e-visible-no' } });
    const viewer = await provisionRoleUser(env, ol, 'viewer');
    const v = await new OlApiClass(env.apiUrl, viewer.username, viewer.password).login();
    const bodies = [(await v.call('GET', `/connections/${c.body.id}`)).body, (await v.call('GET', '/connections')).body, (await ol.call('GET', `/connections/${c.body.id}`)).body, c.body];
    const text = JSON.stringify(bodies);
    await evidence('connection reads as viewer and admin', { credentialsStored: bodies[0].credentialsStored, leaks: /secret-e2e-visible-no|refresh-e2e-visible-no|AKIAE2EVISIBLENO|aws-secret-e2e/.test(text) });
    expect(text).not.toMatch(/secret-e2e-visible-no|refresh-e2e-visible-no|AKIAE2EVISIBLENO|aws-secret-e2e/);
    expect(bodies[0].credentialsStored).toBe(true);
  });
});

test.describe('errors and retries', () => {
  async function conn(ol: OlApi, region: any, tag: string): Promise<string> {
    const c = await createConn(ol, { name: `err ${tag} ${region.region} ${STAMP}${Math.floor(Math.random() * 1000)}`, region, capabilities: ['OrderSource'], orderSyncStart: { mode: 'now' } });
    return c.body.id;
  }
  const poll = { limit: 10, cursorKey: 'amazon.orders.feedCursor' };

  test('P133 a refused refresh token ends the job without retries and moves the connection to needs reauth', async ({ page, ol, region, fake, evidence }) => {
    await fake.reset();
    const id = await conn(ol, region, 'lwa');
    await fake.fail({ kind: 'lwa' });
    const job = await runJob(ol, TASKS.orders, id, poll);
    await fake.clearFailures();
    const status = (await ol.call('GET', `/connections/${id}`)).body.status;
    await page.goto(`/connections/${id}/edit`);
    await expect(page.getByRole('button', { name: 'Re-authorize' })).toBeVisible();
    await shot(page, region.region, 133);
    await evidence('LWA invalid_grant', { job: [job.status, job.outcome, job.attempts, job.lastError], connectionStatus: status });
    expect(job.status).toBe('dead');
    expect(job.attempts).toBeLessThanOrEqual(1);
    expect(status).toBe('needs_reauth');
  });

  test('P134 an expired access token is renewed once and the job succeeds', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const id = await conn(ol, region, 'tok');
    await runJob(ol, TASKS.orders, id, poll);
    const since = new Date().toISOString();
    await fake.fail({ kind: 'expire-tokens' });
    const job = await runJob(ol, TASKS.orders, id, poll);
    const calls = ((await fakeGet(`/__calls?since=${since}`)).calls as any[]).filter((c) => c.path === '/orders/2026-01-01/orders' || c.path === '/auth/o2/token');
    await evidence('expired token mid-run', { job: [job.status, job.outcome, job.attempts], sequence: calls.map((c) => `${c.method} ${c.path} ${c.rejected ?? c.injected ?? ''}`) });
    expect(job.status).toBe('succeeded');
    expect(calls.filter((c) => c.rejected === 'stale-or-missing-token').length).toBe(1);
    expect(calls.filter((c) => c.path === '/auth/o2/token').length).toBeGreaterThanOrEqual(1);
  });

  test('P135 a 429 QuotaExceeded defers the job about 240 s without spending an attempt', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const id = await conn(ol, region, '429');
    await runJob(ol, TASKS.orders, id, poll);
    await fake.fail({ kind: '429', count: 1, path: '/orders/2026-01-01/orders' });
    const job = await runJob(ol, TASKS.orders, id, poll, { until: (j) => j.status === 'queued' && j.nextRunAt !== undefined && Date.parse(j.nextRunAt) > Date.now() + 60_000 });
    const wait = Date.parse(job.nextRunAt!) - Date.now();
    await evidence('429 on searchOrders', { status: job.status, attempts: job.attempts, retryInSeconds: Math.round(wait / 1000), lastError: job.lastError, deferredTotalMs: job.deferredTotalMs });
    expect(job.attempts).toBe(0);
    expect(wait).toBeGreaterThan(200_000);
    expect(wait).toBeLessThan(260_000);
  });

  test('P136 a 503 defers the job about 300 s without a penalty', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const id = await conn(ol, region, '503');
    await runJob(ol, TASKS.orders, id, poll);
    await fake.fail({ kind: '503', count: 1, path: '/orders/2026-01-01/orders' });
    const job = await runJob(ol, TASKS.orders, id, poll, { until: (j) => j.status === 'queued' && j.nextRunAt !== undefined && Date.parse(j.nextRunAt) > Date.now() + 60_000 });
    const wait = Date.parse(job.nextRunAt!) - Date.now();
    await evidence('503 from SP-API', { status: job.status, attempts: job.attempts, retryInSeconds: Math.round(wait / 1000), lastError: job.lastError });
    expect(job.attempts).toBe(0);
    expect(wait).toBeGreaterThan(250_000);
    expect(wait).toBeLessThan(310_000);
  });

  test('P137 400, 403 (missing role) and 404 are terminal, a 403 is not bad credentials', async ({ ol, region, fake, evidence }) => {
    const out: Record<string, unknown> = {};
    for (const [kind, count] of [['400', 1], ['403', 2], ['404', 1]] as const) {
      await fake.reset();
      const id = await conn(ol, region, kind);
      await runJob(ol, TASKS.orders, id, poll);
      await fake.fail({ kind, count, path: '/orders/2026-01-01/orders' });
      const job = await runJob(ol, TASKS.orders, id, poll);
      const status = (await ol.call('GET', `/connections/${id}`)).body.status;
      out[kind] = { status: job.status, outcome: job.outcome, attempts: job.attempts, error: job.lastError, connection: status };
      expect(job.status === 'dead' || job.outcome === 'business_failure', kind).toBe(true);
      expect(job.attempts, kind).toBeLessThanOrEqual(1);
      expect(status, kind).toBe('active');
    }
    await evidence('4xx answers', out);
  });

  test('P138 a 500 is retried on the ladder and the job succeeds once it is gone', async ({ ol, region, fake, evidence }) => {
    test.setTimeout(300_000);
    await fake.reset();
    const id = await conn(ol, region, '500');
    await runJob(ol, TASKS.orders, id, poll);
    await fake.fail({ kind: '500', count: 1, path: '/orders/2026-01-01/orders' });
    const job = await runJob(ol, TASKS.orders, id, poll, { timeoutMs: 240_000, until: (j) => j.status === 'succeeded' || j.status === 'dead' });
    await evidence('500 then recovery', { status: job.status, attempts: job.attempts });
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBeGreaterThanOrEqual(1);
  });

  test('P139 a broken stored config is a terminal error, not a retry storm', async ({ ol, region, fake, evidence }) => {
    await fake.reset();
    const id = await conn(ol, region, 'cfg');
    await sql(`update connections set config = config - 'marketplaceIds' where id = $1`, [id]);
    const job = await runJob(ol, TASKS.orders, id, poll);
    await evidence('config without marketplaceIds', { status: job.status, outcome: job.outcome, attempts: job.attempts, error: job.lastError });
    expect(job.status).toBe('dead');
    expect(job.attempts).toBeLessThanOrEqual(1);
    expect(`${job.lastError}`).toMatch(/config|marketplace/i);
  });

  test('P140 no log line or job error contains a credential', async ({ evidence }) => {
    const logs = ['olamz-api', 'olamz-worker'].map((n) => execFileSync('docker', ['logs', n], { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
    const jobs = await sql<{ lastError: string }>(`select "lastError" from sync_jobs where "lastError" is not null`);
    const text = logs.join('\n') + JSON.stringify(jobs);
    const patterns = [/e2e-fake-secret/, /Atzr\|e2e-fake-refresh-token/, /secret-e2e-visible-no/, /aws-secret-e2e/, /new-secret/, /Atzr\|new-refresh/];
    const hits = patterns.filter((p) => p.test(text)).map(String);
    await evidence('credential patterns searched in api and worker logs and job errors', { searchedBytes: text.length, patterns: patterns.map(String), hits });
    expect(hits).toEqual([]);
  });
});
