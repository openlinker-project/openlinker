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
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXED_NOW,
  buildOrderRecord,
  situationData,
  type OrderDetailSituation,
} from '../../src/support/order-detail-fixtures';

const MOCKUP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/plans/mockups/order-detail-v3.html',
);

/** Share of differing pixels the header may show per situation. */
const BUDGET: Record<OrderDetailSituation, number> = { ready: 0.33, held: 0.15, cancelled: 0.17 };

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
  return { ratio: differing / (width * height), image: PNG.sync.write(out) };
}

test.describe('orders: detail header against the mockup (#4286)', () => {
  // UTC so the times in the sample data read the same as in the mockup on any machine.
  test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });

  for (const situation of ['ready', 'held', 'cancelled'] as const) {
    test(`${situation}: header stays within the visual budget`, async ({ page, api }, testInfo) => {
      const connections = await api.connections.list();
      const sourceConnectionId = connections[0]?.id;
      test.skip(!sourceConnectionId, 'stack has no connection to attribute the order to');

      const data = situationData(situation);
      const record = buildOrderRecord(situation, sourceConnectionId as string);

      await page.clock.setFixedTime(new Date(FIXED_NOW[situation]));
      // Only the API read: the SPA route of the same name is a document request.
      await page.route(`**/orders/${data.orderId}`, async (route) => {
        const type = route.request().resourceType();
        if (route.request().method() !== 'GET' || (type !== 'fetch' && type !== 'xhr')) {
          return route.continue();
        }
        return route.fulfill({ json: record });
      });

      await page.goto(`/orders/${data.orderId}`);
      const header = page.locator('.order-header--card');
      await expect(header).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('tablist')).toBeVisible();
      // Entrance animations and web fonts must be settled, or the shot is blank or reflowed.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      const liveShot = await header.screenshot({ animations: 'disabled' });

      const mockupPage = await page.context().newPage();
      await mockupPage.setViewportSize({ width: 1440, height: 1000 });
      await mockupPage.goto(`file://${MOCKUP}#${data.mockupHash}`);
      const mockupHeader = mockupPage.locator('.b-head').first();
      await expect(mockupHeader).toBeVisible();
      await mockupPage.evaluate(() => document.fonts.ready);
      const mockupShot = await mockupHeader.screenshot({ animations: 'disabled' });
      await mockupPage.close();

      expect(distinctColours(liveShot), 'the live header screenshot is blank').toBeGreaterThan(16);
      expect(distinctColours(mockupShot), 'the mockup header screenshot is blank').toBeGreaterThan(16);
      const { ratio, image } = diffPng(liveShot, mockupShot);
      await testInfo.attach(`${situation} - live`, { body: liveShot, contentType: 'image/png' });
      await testInfo.attach(`${situation} - mockup`, { body: mockupShot, contentType: 'image/png' });
      await testInfo.attach(`${situation} - diff (${(ratio * 100).toFixed(1)}%)`, {
        body: image,
        contentType: 'image/png',
      });

      // Optional: keep the three images on disk (OL_VISUAL_OUT=/some/dir) for review.
      const outDir = process.env.OL_VISUAL_OUT;
      if (outDir) {
        await mkdir(outDir, { recursive: true });
        await writeFile(path.join(outDir, `${situation}-live.png`), liveShot);
        await writeFile(path.join(outDir, `${situation}-mockup.png`), mockupShot);
        await writeFile(path.join(outDir, `${situation}-diff.png`), image);
      }
      testInfo.annotations.push({ type: 'differing-pixels', description: ratio.toFixed(3) });
      console.log(`${situation}: ${(ratio * 100).toFixed(1)}% of header pixels differ`);

      // The mockup's header is 1124 px wide at this viewport; a different width means the layout changed.
      expect(PNG.sync.read(liveShot).width).toBe(PNG.sync.read(mockupShot).width);
      expect(ratio, `differing pixels in the ${situation} header`).toBeLessThan(BUDGET[situation]);
    });
  }
});

