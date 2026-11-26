/**
 * Amazon suite harness: extends the shared `test` with an auto fixture that
 * records every `P<nnn>` point's result and guarantees a screenshot for it
 * (the test's own, if it took one, otherwise the final page state).
 *
 * @module tests/amazon
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect } from '../../src/fixtures/test';
import {
  AmazonFake,
  RUN_DIR,
  evidenceShot,
  recordResult,
  regionOf,
  shot,
  type RegionFixture,
} from '../../src/support/amazon';
import { resolveEnv } from '../../src/config/env';
import { REGIONS } from '../../src/support/amazon';

/** Bearer-token client returning status and body for ANY OL path (validation points need the 4xx too). */
export class OlApi {
  private token = '';
  constructor(
    private readonly base: string,
    private readonly user: string,
    private readonly pass: string,
  ) {}
  async login(): Promise<this> {
    const r = await fetch(`${this.base}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.user, password: this.pass }),
    });
    if (!r.ok) throw new Error(`login ${this.user} failed: ${r.status}`);
    this.token = ((await r.json()) as { access_token: string }).access_token;
    return this;
  }
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const r = await fetch(`${this.base}/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    return { status: r.status, body: parsed };
  }
}

/** Every point a test title names: `P113 and P114`, `P121-P124`, `P061b`. */
export function pointsOf(title: string): number[] {
  const out: number[] = [];
  for (const m of title.matchAll(/P(\d{3})(?:b)?(?:-P(\d{3}))?/g)) {
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    for (let n = from; n <= to; n += 1) if (!out.includes(n)) out.push(n);
  }
  return out;
}

interface Fixtures {
  fake: AmazonFake;
  region: RegionFixture;
  ol: OlApi;
  /** Marks the evidence page used (API/DB points) so the auto shot is not taken over it. */
  evidence: (title: string, observed: unknown) => Promise<void>;
  pointRecorder: void;
  tidyMasters: void;
}

export const test = base.extend<Fixtures>({
  fake: async ({}, use) => {
    await use(new AmazonFake());
  },
  region: async ({}, use, info) => {
    await use(regionOf(info));
  },
  ol: async ({}, use) => {
    const env = resolveEnv();
    await use(await new OlApi(env.apiUrl, env.adminUser, env.adminPass).login());
  },
  evidence: async ({ page }, use, info) => {
    await use(async (title, observed) => {
      await evidenceShot(page, regionOf(info).region, pointsOf(info.title)[0] ?? 0, title, observed);
    });
  },
  tidyMasters: [
    async ({}, use) => {
      await use();
      while (throwawayMasters.length > 0) {
        const t = throwawayMasters.pop()!;
        await t.ol.call('PATCH', `/connections/${t.id}/disable`).catch(() => undefined);
      }
    },
    { auto: true },
  ],
  pointRecorder: [
    async ({ page }, use, info) => {
      const ids = pointsOf(info.title);
      for (const n of ids) rmSync(resolve(RUN_DIR, regionOf(info).region, `${String(n).padStart(3, '0')}.png`), { force: true });
      await use();
      if (ids.length === 0) return;
      const region = regionOf(info).region;
      const first = String(ids[0]).padStart(3, '0');
      const file = resolve(RUN_DIR, region, `${first}.png`);
      let screenshot: string | null = existsSync(file) && info.status === 'passed' ? file : null;
      if (screenshot === null) {
        try {
          screenshot = await shot(page, region, first);
        } catch {
          screenshot = null;
        }
      }
      for (const n of ids.slice(1)) {
        const target = resolve(RUN_DIR, region, `${String(n).padStart(3, '0')}.png`);
        if (screenshot !== null) copyFileSync(screenshot, target);
      }
      const note =
        info.status === 'passed'
          ? info.title
          : (info.error?.message ?? 'failed').replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim() !== '').slice(0, 5).join(' | ').slice(0, 420);
      for (const n of ids) {
        recordResult(region, n, info.status === 'passed' ? 'pass' : 'fail', note, screenshot === null ? null : resolve(RUN_DIR, region, `${String(n).padStart(3, '0')}.png`));
      }
    },
    { auto: true },
  ],
});

export { expect, shot, evidenceShot };

export interface ApiConnOpts {
  name: string;
  region: RegionFixture;
  capabilities: string[];
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  orderSyncStart?: Record<string, unknown>;
}

/** Creates an Amazon connection through the API (the wizard is covered by its own points). */
/** Throwaway ProductMaster connections created by a test: disabled afterwards so their sweeps never import duplicate SKUs. */
export const throwawayMasters: { ol: OlApi; id: string }[] = [];

export async function createConn(ol: OlApi, o: ApiConnOpts): Promise<{ status: number; body: any }> {
  const res = await createConnRaw(ol, o);
  if (res.status === 201 && o.capabilities.includes('ProductMaster') && !o.name.startsWith('E2E ')) throwawayMasters.push({ ol, id: res.body.id });
  return res;
}

async function createConnRaw(ol: OlApi, o: ApiConnOpts): Promise<{ status: number; body: any }> {
  return ol.call('POST', '/connections', {
    name: o.name,
    platformType: 'amazon',
    adapterKey: 'amazon.spapi.v1',
    config: {
      region: o.region.region,
      environment: 'production',
      marketplaceIds: o.region.marketplaces.map((m) => m.id),
      ...(o.config ?? {}),
    },
    credentials: o.credentials ?? { clientId: 'amzn1.application-oa2-client.e2efake', clientSecret: 'e2e-fake-secret', refreshToken: 'Atzr|e2e-fake-refresh-token' },
    enabledCapabilities: o.capabilities,
    ...(o.orderSyncStart ? { orderSyncStart: o.orderSyncStart } : {}),
  });
}

/** Merges a partial config into the stored one (PATCH replaces `config` wholesale). */
export async function patchConfig(ol: OlApi, id: string, partial: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const cur = (await ol.call('GET', `/connections/${id}`)).body;
  return ol.call('PATCH', `/connections/${id}`, { config: { ...cur.config, ...partial } });
}

export interface JobRow {
  id: string;
  jobType: string;
  status: string;
  outcome: string | null;
  attempts: number;
  lastError: string | null;
  outcomeReason?: string | null;
  idempotencyKey: string;
  nextRunAt?: string;
  deferredTotalMs?: number;
  connectionId: string;
  payload?: unknown;
}

export async function listJobs(ol: OlApi, connectionId: string, jobType?: string): Promise<JobRow[]> {
  const q = new URLSearchParams({ connectionId, ...(jobType ? { jobType } : {}), limit: '100' });
  const res = await ol.call('GET', `/sync/jobs?${q.toString()}`);
  return (res.body?.items ?? []) as JobRow[];
}

/** Enqueues a job and waits for a terminal status (succeeded/dead) or, with `until`, any custom state. */
export async function runJob(
  ol: OlApi,
  jobType: string,
  connectionId: string,
  payload: Record<string, unknown>,
  opts: { timeoutMs?: number; until?: (job: JobRow) => boolean } = {},
): Promise<JobRow> {
  const key = `amazon-e2e:${connectionId}:${jobType}:${Date.now()}:${Math.floor(Math.random() * 1e6)}`;
  const enq = await ol.call('POST', '/sync/jobs', { jobType, connectionId, payload: { schemaVersion: 1, ...payload }, idempotencyKey: key });
  if (enq.status >= 300) throw new Error(`enqueue ${jobType} failed: ${enq.status} ${JSON.stringify(enq.body)}`);
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const done = opts.until ?? ((j: JobRow): boolean => j.status === 'succeeded' || j.status === 'dead');
  for (;;) {
    const job = (await listJobs(ol, connectionId, jobType)).find((j) => j.idempotencyKey === key);
    if (job && done(job)) return job;
    if (Date.now() > deadline) throw new Error(`job ${jobType} (${key}) not done in time; last: ${JSON.stringify(job)}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

import pg from 'pg';

/** One-off SQL against the stack's Postgres (cursors, retention anchors, shipment seeds). */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: resolveEnv().databaseUrl });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

export interface OrderRow {
  internalOrderId: string;
  sourceConnectionId: string;
  recordStatus: string;
  orderSnapshot: Record<string, any>;
  [k: string]: any;
}

export async function ordersOf(ol: OlApi, connectionId: string): Promise<OrderRow[]> {
  const res = await ol.call('GET', `/orders?sourceConnectionId=${connectionId}&limit=100`);
  return (res.body?.items ?? []) as OrderRow[];
}

export const extIds = (rows: OrderRow[]): string[] => rows.map((o) => String(o.orderSnapshot.externalOrderId)).sort();

/** Polls (via real poll jobs) until the connection holds all `wanted` external ids, or times out. */
export async function pollUntilHas(ol: OlApi, connectionId: string, wanted: string[], rounds = 6): Promise<OrderRow[]> {
  let rows: OrderRow[] = [];
  for (let i = 0; i < rounds; i += 1) {
    await runJob(ol, 'marketplace.orders.poll', connectionId, { limit: 100, cursorKey: 'amazon.orders.feedCursor' });
    for (let j = 0; j < 10; j += 1) {
      rows = await ordersOf(ol, connectionId);
      if (wanted.every((w) => extIds(rows).includes(w))) return rows;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return rows;
}

export const fakeBuy = async (body: Record<string, unknown>): Promise<string> => {
  const r = await fetch(`http://127.0.0.1:${REGIONS.eu.fakePort}/__buyer/purchase`, { method: 'POST', body: JSON.stringify(body) });
  return ((await r.json()) as { orderId: string }).orderId;
};
export const fakePost = async (path: string, body: Record<string, unknown> = {}): Promise<any> => {
  const r = await fetch(`http://127.0.0.1:${REGIONS.eu.fakePort}${path}`, { method: 'POST', body: JSON.stringify(body) });
  return r.json();
};
export const fakeGet = async (path: string): Promise<any> => (await fetch(`http://127.0.0.1:${REGIONS.eu.fakePort}${path}`)).json();
