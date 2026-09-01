/**
 * Label-download error mapping - visual evidence (#2671)
 *
 * The operator-facing defect this fixes: every backend outcome from
 * `GET /shipments/:id/label` collapsed into one toast, "Could not download
 * the label. Try again." - wrong for 404/422, where retrying can never help.
 * This walks the real `/shipments` row accordion through every failure class
 * against a stubbed OL API (no seeded stack, no shared auth artifact - the
 * session bootstrap is stubbed too, same shape as `wizard-blockers`), so the
 * project needs only a served web app.
 *
 * Each case writes a named screenshot into its own test output directory and
 * attaches it to the HTML report - a copy change is best evidenced by a
 * picture of the copy, not by an assertion string alone.
 *
 * @module tests/label-download-errors
 */
import { test, type Page, type TestInfo } from '@playwright/test';
import {
  SHIPMENT_ID,
  stubLabelDownloadFailure,
  stubShipmentsPageApi,
  type FailureCase,
} from './stub';

async function captureState(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/**
 * Open the /shipments page, expand the seeded row, click Download label.
 * Below the mobile breakpoint `DataTable` renders cards instead of the
 * desktop accordion (`renderCards = cardView && isMobile`,
 * `shared/ui/data-table.tsx`), and the mobile card's own disclosure toggle
 * reads "View full details" / "Hide details", not "Expand details for
 * shipment ...". Both toggles land on the same `ShipmentRowDetail`.
 */
async function triggerDownload(page: Page, viewportWidth = 1280): Promise<void> {
  await page.goto('/shipments');
  const toggle =
    viewportWidth < 768
      ? page.getByRole('button', { name: 'View full details' })
      : page.getByRole('button', { name: `Expand details for shipment ${SHIPMENT_ID}` });
  await toggle.click();
  await page.getByRole('button', { name: 'Download label' }).click();
}

const CASES: Array<{ kind: FailureCase; title: string }> = [
  { kind: 'not-found', title: 'no shipment matches this id' },
  { kind: 'not-yet-generated', title: 'no label to download yet' },
  { kind: 'carrier-unsupported', title: 'this carrier doesn’t provide a downloadable label' },
  { kind: 'provider-rejection', title: 'the carrier rejected the request' },
  { kind: 'provider-auth', title: 'our stored carrier credentials were rejected' },
  { kind: 'unclassified', title: 'something went wrong' },
  { kind: 'network', title: 'couldn’t reach openlinker' },
];

test.describe('label-download failure toasts, desktop', () => {
  for (const { kind, title } of CASES) {
    test(`${kind} renders "${title}"`, async ({ page }, testInfo) => {
      await stubShipmentsPageApi(page);
      await stubLabelDownloadFailure(page, kind);
      await triggerDownload(page);

      // `.toast__title` scoped explicitly: Radix's aria-live announcer
      // duplicates the toast text into a second, hidden `role="status"`
      // region, which a bare `getByText` also matches (strict-mode violation).
      await page.locator('.toast__title').getByText(new RegExp(title, 'i')).waitFor();
      await captureState(page, testInfo, `desktop-${kind}`);
    });
  }
});

// Breakpoints (#2671 review): no CSS changed by this fix - same `Toast` /
// `Button` components, same existing responsive rules - but the fix is
// worth seeing at the widths that actually stack `.shipment-action-buttons`
// and reflow `.toast-region`, not just assumed from the unchanged CSS.
const BREAKPOINT_CASES: Array<{ kind: FailureCase; width: number; height: number; label: string }> = [
  { kind: 'not-found', width: 375, height: 812, label: 'mobile' },
  { kind: 'provider-auth', width: 375, height: 812, label: 'mobile' },
  { kind: 'provider-rejection', width: 768, height: 1024, label: 'tablet' },
];

test.describe('label-download failure toasts, responsive', () => {
  for (const { kind, width, height, label } of BREAKPOINT_CASES) {
    test(`${kind} at ${label} (${width}x${height})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await stubShipmentsPageApi(page);
      await stubLabelDownloadFailure(page, kind);
      await triggerDownload(page, width);

      await page.waitForTimeout(300); // let the toast slide-in animation settle
      await captureState(page, testInfo, `${label}-${kind}`);
    });
  }
});
