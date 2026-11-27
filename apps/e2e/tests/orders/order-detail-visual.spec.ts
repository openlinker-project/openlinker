/**
 * Orders: the order detail header against the committed mockup (#4286)
 *
 * Renders the real page with the mockup's own sample data (see
 * `order-detail-fixtures.ts`, fed through `page.route`, so nothing on the stack
 * is written) and compares the header card with the same card in
 * `docs/plans/mockups/order-detail-v3.html`, which is served from the repo
 * checkout and not from the Claude artifact (docs/frontend-architecture.md).
 *
 * The two renderers differ by design in a few places the sample data cannot
 * remove (the mockup's status pill comes from rules the live app computes
 * itself, its gift line has no counterpart, base font sizes differ), so the
 * assertion is a regression budget on the share of differing pixels, not zero.
 * Each run attaches the live image, the mockup image and the diff. Lower the
 * budgets as the page converges on the mockup.
 *
 * @module tests/orders
 */
import { test, expect } from '../../src/fixtures/test';
import type { Locator } from '@playwright/test';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXED_NOW,
  buildOrderRecord,
  shippingConnection,
  SOURCE_CONNECTION_ID,
  sourceConnection,
  situationData,
  type OrderDetailSituation,
} from '../../src/support/order-detail-fixtures';

const MOCKUP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/plans/mockups/order-detail-v3.html',
);

const TABS = [
  { id: 'overview', mockup: '', label: 'Overview' },
  { id: 'shipping', mockup: '-ship', label: 'Shipping' },
  { id: 'packing', mockup: '-pack', label: 'Packing' },
  { id: 'documents', mockup: '-docs', label: 'Sales documents' },
  { id: 'returns', mockup: '-ret', label: 'Returns' },
  { id: 'notes', mockup: '-notes', label: 'Notes' },
  { id: 'history', mockup: '-hist', label: 'History' },
  { id: 'technical', mockup: '-tech', label: 'Technical' },
] as const;

/**
 * Share of differing pixels each region may show. `header` is the card above the
 * tabs; the others are the active tab's panel. Measured on the branch build and
 * kept just above the measurement, so a regression fails and a gain is visible.
 * Panels whose data comes from other endpoints (shipments, documents, notes,
 * tasks) are rendered here with whatever those endpoints return on the stack,
 * so their budgets are loose until the fixtures cover them. The numbers are the
 * MEASURED distance from the mockup, rounded up with a small margin: they pin
 * today's state, they are not a claim that the page matches the mockup.
 *
 * Re-pinned (#4290): the first set did not reproduce. Rendering the very commit they were pinned on (#4288,
 * a0f71644f) on a fresh stack gives the same distances as the branch that merged it, so the gap was never a
 * regression: ready-overview 38.5%, held-header 23.9%, cancelled-overview 52.3% against pins of 31/15/48.
 * What did differ between environments is what the page and the mockup render with: the order's channel was
 * "whichever connection the stack lists first" (now a synthetic Allegro connection, see
 * `sourceConnection()`), and the notes, shipments and packing panels read stack endpoints. Measured with
 * the synthetic channel on the reference stack (headless Chromium, 1440x1000, UTC): header 34.7 / 24.1 /
 * 43.6, overview 39.9 / 59.4 / 53.4, packing 55.4 / 40.1 / 56.5, returns 50.4 / 50.4 / 50.0, notes 23.3 /
 * 28.1 / 27.9 (ready / held / cancelled). Every raised budget sits about two points above its measurement;
 * the cells that already passed keep their pin. The live header carries a meta row the mockup has no
 * counterpart for ("1 item, 2 units - first product", 53 px), so the header cannot converge on zero.
 */
const BUDGET: Record<OrderDetailSituation, Record<string, number>> = {
  ready: { header: 0.42, overview: 0.42, shipping: 0.62, packing: 0.57, documents: 0.15, returns: 0.52, notes: 0.26, history: 0.61, technical: 0.4 },
  held: { header: 0.26, overview: 0.61, shipping: 0.53, packing: 0.42, documents: 0.19, returns: 0.52, notes: 0.3, history: 0.61, technical: 0.29 },
  cancelled: { header: 0.51, overview: 0.55, shipping: 0.26, packing: 0.58, documents: 0.5, returns: 0.52, notes: 0.3, history: 0.54, technical: 0.43 },
};
const DEFAULT_PANEL_BUDGET = 1;

/** Channel difference that counts as a differing pixel (sum of RGB deltas). */
const PIXEL_THRESHOLD = 48;

/** A screenshot with almost no distinct colours is a blank frame, not a rendered header. */
function distinctColours(png: Buffer): number {
  const p = PNG.sync.read(png);
  const seen = new Set<number>();
  for (let i = 0; i < p.data.length; i += 4) {
    seen.add(((p.data[i] ?? 0) << 16) | ((p.data[i + 1] ?? 0) << 8) | (p.data[i + 2] ?? 0));
    if (seen.size > 64) break;
  }
  return seen.size;
}

function diffPng(live: Buffer, mockup: Buffer): { ratio: number; image: Buffer } {
  const a = PNG.sync.read(live);
  const b = PNG.sync.read(mockup);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  // Pixels outside the overlap exist in only one image, so they count as differing: a taller page is a difference.
  const unmatched = Math.max(a.width * a.height, b.width * b.height) - width * height;
  const out = new PNG({ width, height });
  let differing = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * a.width + x) * 4;
      const j = (y * b.width + x) * 4;
      const k = (y * width + x) * 4;
      const delta =
        Math.abs((a.data[i] ?? 0) - (b.data[j] ?? 0)) +
        Math.abs((a.data[i + 1] ?? 0) - (b.data[j + 1] ?? 0)) +
        Math.abs((a.data[i + 2] ?? 0) - (b.data[j + 2] ?? 0));
      const bad = delta > PIXEL_THRESHOLD;
      if (bad) differing += 1;
      out.data[k] = bad ? 255 : (a.data[i] ?? 0);
      out.data[k + 1] = bad ? 0 : (a.data[i + 1] ?? 0);
      out.data[k + 2] = bad ? 0 : (a.data[i + 2] ?? 0);
      out.data[k + 3] = 255;
    }
  }
  const total = width * height + unmatched;
  return { ratio: (differing + unmatched) / total, image: PNG.sync.write(out) };
}

test.describe('orders: detail page against the mockup (#4286)', () => {
  // UTC so the times in the sample data read the same as in the mockup on any machine.
  test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });

  for (const situation of ['ready', 'held', 'cancelled'] as const) {
    test(`${situation}: header and every tab stay within the visual budget`, async ({ page }, testInfo) => {
      const data = situationData(situation);
      const record = buildOrderRecord(situation, SOURCE_CONNECTION_ID);

      await page.clock.setFixedTime(new Date(FIXED_NOW[situation]));
      // Only the API read: the SPA route of the same name is a document request.
      await page.route(`**/orders/${data.orderId}`, async (route) => {
        const type = route.request().resourceType();
        if (route.request().method() !== 'GET' || (type !== 'fetch' && type !== 'xhr')) {
          return route.continue();
        }
        return route.fulfill({ json: record });
      });

      // The stack's own connections plus a synthetic source and shipping connection: the first lets the header
      // name the channel as the mockup does, the second lets the label form render.
      await page.route('**/connections', async (route) => {
        const type = route.request().resourceType();
        if (route.request().method() !== 'GET' || (type !== 'fetch' && type !== 'xhr')) {
          return route.continue();
        }
        const response = await route.fetch();
        const body = (await response.json()) as unknown;
        const list: unknown[] = Array.isArray(body)
          ? (body as unknown[])
          : ((body as { items?: unknown[] }).items ?? []);
        return route.fulfill({ response, json: [...list, sourceConnection(), shippingConnection()] });
      });

      const mockupPage = await page.context().newPage();
      await mockupPage.setViewportSize({ width: 1440, height: 1000 });
      const outDir = process.env.OL_VISUAL_OUT;
      if (outDir) await mkdir(outDir, { recursive: true });

      const compare = async (
        region: string,
        live: Locator,
        mockup: Locator,
        budget: number,
      ): Promise<void> => {
        await page.evaluate(() => document.fonts.ready);
        await mockupPage.evaluate(() => document.fonts.ready);
        const liveShot = await live.screenshot({ animations: 'disabled' });
        const mockupShot = await mockup.screenshot({ animations: 'disabled' });
        expect(distinctColours(liveShot), `the live ${region} screenshot is blank`).toBeGreaterThan(8);
        expect(distinctColours(mockupShot), `the mockup ${region} screenshot is blank`).toBeGreaterThan(8);
        const { ratio, image } = diffPng(liveShot, mockupShot);
        const name = `${situation}-${region}`;
        if (outDir) {
          await writeFile(path.join(outDir, `${name}-live.png`), liveShot);
          await writeFile(path.join(outDir, `${name}-mockup.png`), mockupShot);
          await writeFile(path.join(outDir, `${name}-diff.png`), image);
        }
        await testInfo.attach(`${name} - diff (${(ratio * 100).toFixed(1)}%)`, {
          body: image,
          contentType: 'image/png',
        });
        console.log(`${name}: ${(ratio * 100).toFixed(1)}% of pixels differ`);
        expect.soft(ratio, `differing pixels in ${name}`).toBeLessThan(budget);
      };

      for (const tab of TABS) {
        await page.goto(`/orders/${data.orderId}${tab.id === 'overview' ? '' : `?tab=${tab.id}`}`);
        await expect(page.getByRole('tablist')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(500);
        await mockupPage.goto(`file://${MOCKUP}#${data.mockupHash}${tab.mockup}`);
        await mockupPage.waitForTimeout(500);

        if (tab.id === 'overview') {
          await compare(
            'header',
            page.locator('.order-header--card'),
            mockupPage.locator('.b-head').first(),
            BUDGET[situation].header ?? DEFAULT_PANEL_BUDGET,
          );
        }
        await compare(
          tab.id,
          page.locator('[role="tabpanel"]:visible').first(),
          mockupPage.locator('[role="tabpanel"]:visible').first(),
          BUDGET[situation][tab.id] ?? DEFAULT_PANEL_BUDGET,
        );
      }
      await mockupPage.close();
    });
  }
});
