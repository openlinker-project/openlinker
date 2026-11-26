/**
 * Amazon E2E support (#4262, layer 1: fake SP-API)
 *
 * Region table, a client for the fake server's control endpoints, screenshot
 * and result recording. Screenshots go to `local-e2e-runs/amazon/<region>/`
 * (untracked scratch); results are appended to `results.jsonl` and folded into
 * `docs/plans/amazon-e2e-results.md` by `scripts/amazon-results-table.mjs`.
 *
 * @module support
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';

export type AmazonRegion = 'eu' | 'na' | 'fe';

export interface RegionFixture {
  readonly region: AmazonRegion;
  /** The fake's listener for this region, as the HOST reaches it. */
  readonly fakePort: number;
  /** The fake's base URL as the api/worker CONTAINERS reach it (what lands in a call's `host`). */
  readonly containerHost: string;
  readonly marketplaces: readonly { id: string; country: string; currency: string }[];
  readonly label: string;
}

const FAKE_HOST = process.env.AMAZON_FAKE_HOST ?? 'http://127.0.0.1';

export const REGIONS: Readonly<Record<AmazonRegion, RegionFixture>> = {
  eu: {
    region: 'eu',
    fakePort: Number(process.env.AMAZON_FAKE_EU_HOST_PORT ?? 58101),
    containerHost: 'amazon-fake:4101',
    label: 'Europe (EU)',
    marketplaces: [
      { id: 'A1C3SOZRARQ6R3', country: 'PL', currency: 'PLN' },
      { id: 'A1PA6795UKMFR9', country: 'DE', currency: 'EUR' },
    ],
  },
  na: {
    region: 'na',
    fakePort: Number(process.env.AMAZON_FAKE_NA_HOST_PORT ?? 58102),
    containerHost: 'amazon-fake:4102',
    label: 'North America (NA)',
    marketplaces: [{ id: 'ATVPDKIKX0DER', country: 'US', currency: 'USD' }],
  },
  fe: {
    region: 'fe',
    fakePort: Number(process.env.AMAZON_FAKE_FE_HOST_PORT ?? 58103),
    containerHost: 'amazon-fake:4103',
    label: 'Far East (FE)',
    marketplaces: [{ id: 'A1VC38T7YXB528', country: 'JP', currency: 'JPY' }],
  },
};

export function regionOf(info: TestInfo): RegionFixture {
  const name = info.project.name.replace('amazon-', '') as AmazonRegion;
  const fixture = REGIONS[name];
  if (!fixture) throw new Error(`Not an amazon project: ${info.project.name}`);
  return fixture;
}

export interface FakeCall {
  at: string;
  port: number;
  region?: string;
  host?: string;
  method: string;
  path: string;
  query?: Record<string, string>;
  hasAccessToken?: boolean;
  tokenPrefix?: string | null;
  userAgent?: string | null;
  body?: string | null;
  injected?: string;
  rejected?: string;
  grantType?: string | null;
  scope?: string | null;
  hasClientSecret?: boolean;
}

/** Client for the fake's control endpoints (always reached through the EU listener's port). */
export class AmazonFake {
  private readonly base = `${FAKE_HOST}:${REGIONS.eu.fakePort}`;

  async calls(filter: { port?: number; path?: string; since?: string } = {}): Promise<FakeCall[]> {
    const q = new URLSearchParams();
    if (filter.port) q.set('port', String(filter.port));
    if (filter.path) q.set('path', filter.path);
    if (filter.since) q.set('since', filter.since);
    const res = await fetch(`${this.base}/__calls?${q.toString()}`);
    return ((await res.json()) as { calls: FakeCall[] }).calls;
  }

  async reset(): Promise<void> {
    await fetch(`${this.base}/__reset`, { method: 'POST' });
  }

  async fail(spec: { kind: string; count?: number; path?: string; port?: number }): Promise<void> {
    await fetch(`${this.base}/__fail`, { method: 'POST', body: JSON.stringify(spec) });
  }

  async clearFailures(): Promise<void> {
    await fetch(`${this.base}/__fail`, { method: 'POST', body: JSON.stringify({ clear: true }) });
  }

  async state(patch?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/__state`, {
      method: patch ? 'POST' : 'GET',
      ...(patch ? { body: JSON.stringify(patch) } : {}),
    });
    return (await res.json()) as Record<string, unknown>;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUN_DIR = resolve(HERE, '../../local-e2e-runs/amazon');

/** A full-page screenshot for one manual-test point: `<region>/<point>.png`. */
export async function shot(page: Page, region: AmazonRegion, point: number | string): Promise<string> {
  const dir = resolve(RUN_DIR, region);
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${String(point).padStart(3, '0')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * Evidence page for a point with no UI of its own (an API, DB or job check):
 * renders what was OBSERVED (request, response, fake call log) as an HTML card
 * and shoots that. Never used to claim a UI state.
 */
export async function evidenceShot(
  page: Page,
  region: AmazonRegion,
  point: number | string,
  title: string,
  observed: unknown,
): Promise<string> {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await page.setContent(
    `<html><body style="font:14px system-ui;margin:24px;max-width:1100px">
      <h2 style="margin:0 0 4px">Point ${String(point)} - ${esc(title)}</h2>
      <div style="color:#666;margin-bottom:12px">region ${region} - observed ${new Date().toISOString()}</div>
      <pre style="background:#f6f8fa;padding:14px;border-radius:6px;white-space:pre-wrap;word-break:break-word">${esc(JSON.stringify(observed, null, 2))}</pre>
    </body></html>`,
  );
  return shot(page, region, point);
}

export type PointResult = 'pass' | 'fail' | 'skipped-live-only' | 'not-verified';

export function recordResult(
  region: AmazonRegion,
  point: number,
  result: PointResult,
  note: string,
  screenshot: string | null,
): void {
  mkdirSync(RUN_DIR, { recursive: true });
  appendFileSync(
    resolve(RUN_DIR, 'results.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), region, point, result, note, screenshot })}\n`,
  );
}
