/**
 * Amazon suite harness: extends the shared `test` with an auto fixture that
 * records every `P<nnn>` point's result and guarantees a screenshot for it
 * (the test's own, if it took one, otherwise the final page state).
 *
 * @module tests/amazon
 */
import { existsSync, rmSync } from 'node:fs';
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

interface Fixtures {
  fake: AmazonFake;
  region: RegionFixture;
  ol: OlApi;
  /** Marks the evidence page used (API/DB points) so the auto shot is not taken over it. */
  evidence: (title: string, observed: unknown) => Promise<void>;
  pointRecorder: void;
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
    const m = /^P(\d{3})/.exec(info.title);
    await use(async (title, observed) => {
      await evidenceShot(page, regionOf(info).region, Number(m?.[1] ?? 0), title, observed);
    });
  },
  pointRecorder: [
    async ({ page }, use, info) => {
      const m = /^P(\d{3})/.exec(info.title);
      if (m) rmSync(resolve(RUN_DIR, regionOf(info).region, `${m[1]}.png`), { force: true });
      await use();
      if (!m) return;
      const point = Number(m[1]);
      const region = regionOf(info).region;
      const file = resolve(RUN_DIR, region, `${m[1]}.png`);
      let screenshot: string | null = existsSync(file) && info.status === 'passed' ? file : null;
      if (screenshot === null) {
        try {
          screenshot = await shot(page, region, m[1]!);
        } catch {
          screenshot = null;
        }
      }
      recordResult(
        region,
        point,
        info.status === 'passed' ? 'pass' : 'fail',
        info.status === 'passed' ? info.title : (info.error?.message ?? 'failed').split('\n')[0]!.slice(0, 300),
        screenshot,
      );
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
export async function createConn(ol: OlApi, o: ApiConnOpts): Promise<{ status: number; body: any }> {
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
