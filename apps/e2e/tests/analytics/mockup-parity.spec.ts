/**
 * Analytics mockup parity — state-by-state verification (#2482)
 *
 * For every `data-state` the mockup defines
 * (`docs/plans/mockups/analytics-display-currency-picker.html`), this walks
 * the REAL, running `/analytics` page into the same state and compares it
 * against the mockup — a screenshot of each (for a human), plus real content
 * assertions (for the gate). Both screenshots come from the same test run so
 * they can be viewed side by side in the HTML report.
 *
 * MUTATING and destructive-adjacent: synthesizes real PrestaShop orders and,
 * for the currency states, temporarily flips the deployment-wide reporting
 * currency (restored in a `finally` block, best-effort). Never run this against
 * a shared stack another session is reading `/analytics` on — see the
 * package README's shared-stack warning and this project's own comment in
 * `playwright.config.ts`.
 *
 * MOCKUP FILE ONLY, NEVER THE ARTIFACT URL — hard requirement from the issue.
 * `AnalyticsMockupPage` opens `docs/plans/mockups/analytics-display-currency-picker.html`
 * directly off disk via `file://`.
 *
 * ## Coverage
 *
 * 15 states total, per the issue's own state table.
 *
 * Fully compared (screenshot + content, both mockup and real app) — 11:
 * `native`, `converting`, `converted`, `unavailable`, `settings-open`,
 * `all-clear`, `detail-currency`, `currency-in-progress`, `currency-fixed`,
 * `detail-mapping`, `detail-novat`.
 *
 * Documented divergence (mockup screenshotted; real app asserted to NOT have
 * the mockup's confirm step — a real product gap, not a spec defect) — 1:
 * `tax-confirm`. See #2857.
 *
 * Skipped with a named, verified reason (mockup screenshotted only) — 3:
 * `detail-tax` / `detail-postrollout` (tax-a / tax-c: `taxRateEra =
 * 'pre-rollout'` is written only by a one-time historical migration, never by
 * ingestion — structurally unreachable by a fresh order; see #2855, the
 * proposed test-only seam this suite will consume once it lands), and
 * `currency-failed` (no legitimate flow-driven way was found to force the
 * currency-recalculation DRIVER JOB itself to fail — every reachable error
 * path this suite could produce routes to the "stuck run" conflict UI
 * instead, not a `failed` badge; see #2875).
 *
 * @module tests/analytics
 */
import { test, expect } from '../../src/fixtures/test';
import { buildPrestashopWebserviceClient } from '../../src/support/order-synthesis';
import {
  seedCurrencyMismatchOrder,
  seedUnmappedProductOrder,
  seedNoRateProductOrder,
  widePastToFutureRange,
  type CurrencyMismatchFixture,
} from '../../src/support/analytics-seed';
import { AnalyticsMockupPage, type MockupState } from '../../src/pages/analytics-mockup.page';
import type { TestInfo, Page, Locator } from '@playwright/test';

/** Screenshots both regions for `state` and attaches them side by side to the HTML report. */
async function captureBoth(
  testInfo: TestInfo,
  mockupRegion: Locator,
  realPage: Page,
  state: string,
): Promise<void> {
  const mockupFile = testInfo.outputPath(`${state}--mockup.png`);
  const realFile = testInfo.outputPath(`${state}--real.png`);
  await mockupRegion.screenshot({ path: mockupFile });
  await realPage.screenshot({ path: realFile, fullPage: true });
  await testInfo.attach(`${state} — mockup`, { path: mockupFile, contentType: 'image/png' });
  await testInfo.attach(`${state} — real app`, { path: realFile, contentType: 'image/png' });
}

test.describe('analytics mockup parity (#2482)', () => {
  test('every reachable mockup state matches the real /analytics page', async ({
    page,
    pages,
    api,
    world,
    jobs,
    poll,
  }, testInfo) => {
    const ps = buildPrestashopWebserviceClient(world);
    test.skip(!ps, 'needs OL_PS_WEBSERVICE_KEY (+ a resolvable PS base URL) to seed real orders');

    // The mockup (a static `file://` document) and the real /analytics app
    // (a live page navigation) must NOT share one tab: `pages.analyticsMockup`
    // and `pages.analytics` both default to the single `page` fixture, so
    // interleaving `gotoState(...)` calls on the mockup with real-app
    // navigation/clicks on the same tab makes each step race the other's DOM
    // — observed live as both a mockup nav-strip click landing on the real
    // app and a real-app click landing on the mockup. A dedicated second tab
    // for the mockup removes the race structurally.
    const mockupPage = await page.context().newPage();
    pages.analyticsMockup = new AnalyticsMockupPage(mockupPage);

    const range = widePastToFutureRange();
    let currencyFixture: CurrencyMismatchFixture | null = null;

    try {
      // ── Seed everything up front so state-switching (mockup nav, real-app
      //    navigation) never races a fixture that isn't ready yet ──────────
      await test.step('seed: currency-mismatch order', async () => {
        currencyFixture = await seedCurrencyMismatchOrder({ api, world, jobs, poll });
      });

      const unmappedOrder = await test.step('seed: unmapped-product order (product-matching)', async () =>
        seedUnmappedProductOrder({ api, world, jobs, poll }));

      const noRateOrder = await test.step('seed: no-rate-product order (tax-b)', async () =>
        seedNoRateProductOrder({ api, world, jobs, poll }));

      // ── Mockup-only states: native / all-clear baseline, settings-open ──
      await test.step('native', async () => {
        await pages.analyticsMockup.goto();
        await pages.analytics.goto({ from: range.from, to: range.to });
        await captureBoth(testInfo, pages.analyticsMockup.regionFor('native'), page, 'native');
        await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
      });

      await test.step('settings-open', async () => {
        await pages.analyticsMockup.gotoState('settings-open');
        await pages.analytics.openSettings();
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('settings-open'),
          page,
          'settings-open',
        );
        await expect(pages.analytics.settingsDialog).toContainText('Analytics settings');
        await expect(pages.analytics.settingsDialog).toContainText('Show amounts in');
        await expect(pages.analytics.settingsDialog).toContainText('Rate basis');
        await expect(pages.analytics.settingsDialog).toContainText('Currency — recalculation');
        await expect(pages.analytics.settingsDialog).toContainText('Tax rates');
        await page.getByRole('button', { name: 'Cancel' }).click();
      });

      // ── Display-currency conversion: converting / converted / unavailable ──
      // `seedCurrencyMismatchOrder` has already flipped the deployment's
      // reporting currency (restored only in the outer `finally`, since the
      // LATER coverage states below need it to stay flipped to keep reading
      // as a mismatch). So `currentReportingCurrency` — not a hardcoded
      // 'EUR' — is whatever the deployment reports in RIGHT NOW, and asking
      // the picker to convert TO that currency is a no-op that never fetches
      // or shows a transient state at all. `stampedCurrency` (the ORIGINAL,
      // pre-flip setting) is the one currency guaranteed to differ from it —
      // with only two supported currencies (PLN/EUR) that is also the only
      // other option, so this is the one real conversion this run can drive.
      const targetCurrency = currencyFixture!.stampedCurrency;
      const convertingRe = new RegExp(`Converting to ${targetCurrency}`);
      const convertedRe = new RegExp(`converted to ${targetCurrency}`, 'i');
      const unavailableRe = new RegExp(`Couldn.t get today.s ${targetCurrency} rate`);

      await test.step('converting', async () => {
        await pages.analyticsMockup.gotoState('converting');
        // Delay the sales-analytics response so the transient loading alert
        // is observable deterministically — this is a network-timing aid,
        // not a data fixture: the response body itself is untouched.
        await page.route('**/v1/analytics/sales**', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await route.continue();
        });
        const gotoPromise = pages.analytics.goto({
          from: range.from,
          to: range.to,
          displayCurrency: targetCurrency,
        });
        await expect(pages.analytics.convertNote).toContainText(convertingRe);
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('converting'),
          page,
          'converting',
        );
        await gotoPromise;
        await page.unroute('**/v1/analytics/sales**');
      });

      await test.step('converted', async () => {
        await pages.analyticsMockup.gotoState('converted');
        await pages.analytics.goto({ from: range.from, to: range.to, displayCurrency: targetCurrency });
        await expect(pages.analytics.convertNote).toContainText(convertedRe);
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('converted'),
          page,
          'converted',
        );
      });

      await test.step('unavailable', async () => {
        await pages.analyticsMockup.gotoState('unavailable');
        // No flow-driven way to make the real exchange-rate provider fail on
        // demand (NBP/ECB are public, generally-reliable services this suite
        // has no control over) — the ONE state in this spec exercised via
        // network-response mutation rather than a seeded fixture. This tests
        // the frontend's OWN handling of the shape its API contract already
        // defines (`displayCurrencyConversion.convertedRevenue: null`), not a
        // fabricated backend state.
        await page.route('**/v1/analytics/sales**', async (route) => {
          const response = await route.fetch();
          const body = (await response.json()) as {
            headline?: { displayCurrencyConversion?: { convertedRevenue: number | null } };
          };
          if (body.headline?.displayCurrencyConversion) {
            body.headline.displayCurrencyConversion.convertedRevenue = null;
          }
          await route.fulfill({ response, json: body });
        });
        await pages.analytics.goto({ from: range.from, to: range.to, displayCurrency: targetCurrency });
        await expect(pages.analytics.convertNote).toContainText(unavailableRe);
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('unavailable'),
          page,
          'unavailable',
        );
        await page.unroute('**/v1/analytics/sales**');
      });

      // ── Data Coverage panel: all-clear baseline before any category opens ──
      await test.step('all-clear', async () => {
        await pages.analyticsMockup.gotoState('all-clear');
        // A window BEFORE anything in this suite was seeded, on a
        // freshly-scoped connection with nothing to report — the honest way
        // to observe the zero-categories row without faking an empty
        // coverage response.
        const priorRange = {
          from: new Date(0).toISOString(),
          to: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        };
        await pages.analytics.goto(priorRange);
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('all-clear'),
          page,
          'all-clear',
        );
        await expect(pages.analytics.allClearRow).toBeVisible();
      });

      // ── Data Coverage: currency category, all four sub-states ───────────
      await test.step('detail-currency', async () => {
        await pages.analyticsMockup.gotoState('detail-currency');
        await pages.analytics.goto({ from: range.from, to: range.to });
        const dialog = await pages.analytics.openCoverageDetail('currency');
        await expect(dialog).toContainText('counted in an outdated currency');
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('detail-currency'),
          page,
          'detail-currency',
        );
      });

      await test.step('currency-in-progress', async () => {
        await pages.analyticsMockup.gotoState('currency-in-progress');
        // The dialog from the previous step is still open on `page` — start
        // the real recalculation from it.
        await pages.analytics.recalculateNow();
        await expect(pages.analytics.currencyRow).toContainText(/In progress|Fixed/, { timeout: 15_000 });
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('currency-in-progress'),
          page,
          'currency-in-progress',
        );
      });

      await test.step('currency-fixed', async () => {
        await pages.analyticsMockup.gotoState('currency-fixed');
        // "Fixed" is a real but TRANSIENT (~2s) dwell state before the row
        // disappears (RESOLVED_DWELL_MS, analytics-data-coverage-panel.tsx) —
        // poll for it rather than assuming a fixed wait catches it.
        await expect(pages.analytics.currencyRow).toContainText('Fixed', { timeout: 30_000 });
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('currency-fixed'),
          page,
          'currency-fixed',
        );
        // Row disappears once resolved — confirm the category clears rather
        // than lingering, which would itself be a real product defect.
        await expect(pages.analytics.coverageRow('currency')).toHaveCount(0, { timeout: 10_000 });
      });

      // ── tax-confirm: documented mockup/real-app divergence (#2857) ──────
      await test.step('tax-confirm', async () => {
        await pages.analyticsMockup.gotoState('tax-confirm');
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('tax-confirm'),
          page,
          'tax-confirm-mockup-reference',
        );
        // The mockup shows a confirm dialog ("Turn on including orders with a
        // guessed tax rate?") before the toggle applies. The shipped
        // AnalyticsSettingsDialog's `handleTaxToggleChange` writes directly
        // on change with no confirm step (#2857) — asserted here as a real,
        // known divergence rather than silently glossed over.
        await pages.analytics.openSettings();
        const toggle = pages.analytics.settingsDialog.getByRole('checkbox', {
          name: /Use the rate found in the product catalog/,
        });
        await toggle.waitFor({ state: 'visible' });
        const before = await toggle.isChecked();
        await toggle.click();
        await expect(
          page.getByRole('dialog', { name: /Confirm including tax-rate-guessed orders/ }),
          'known divergence #2857: the mockup shows a confirm dialog here; the shipped Settings dialog toggles directly with no confirm step',
        ).toHaveCount(0);
        // Restore the toggle to its prior value so this run leaves the
        // deployment-wide setting unchanged.
        if ((await toggle.isChecked()) !== before) {
          await toggle.click();
        }
        await page.getByRole('button', { name: 'Cancel' }).click();
      });

      // ── detail-mapping: product-matching category ───────────────────────
      await test.step('detail-mapping', async () => {
        await pages.analyticsMockup.gotoState('detail-mapping');
        await pages.analytics.goto({ from: range.from, to: range.to });
        const dialog = await pages.analytics.openCoverageDetail('product-matching');
        await expect(dialog).toContainText('with a product-matching error');
        await captureBoth(
          testInfo,
          pages.analyticsMockup.regionFor('detail-mapping'),
          page,
          'detail-mapping',
        );
        // Asserted against the API response rather than the (paginated)
        // modal DOM, since the seeded row is not guaranteed to land on the
        // dialog's first page.
        const matching = await api.analytics.getMatchingCoverageOrders({ ...range, limit: 100 });
        expect(
          matching.items.map((item) => item.internalOrderId),
          `product-matching: seeded order ${unmappedOrder.internalOrderId} should appear in the coverage list`,
        ).toContain(unmappedOrder.internalOrderId);
      });

      // ── detail-novat: tax-b category (genuinely unresolved tax rate) ───
      await test.step('detail-novat', async () => {
        await pages.analyticsMockup.gotoState('detail-novat');
        await pages.analytics.goto({ from: range.from, to: range.to });
        const dialog = await pages.analytics.openCoverageDetail('tax-b');
        await expect(dialog).toContainText('have no tax rate at all');
        await captureBoth(testInfo, pages.analyticsMockup.regionFor('detail-novat'), page, 'detail-novat');
        const taxB = await api.analytics.getTaxCoverageOrders({
          ...range,
          category: 'tax-b',
          limit: 100,
        });
        expect(
          taxB.items.map((item) => item.internalOrderId),
          `tax-b: seeded order ${noRateOrder.internalOrderId} should appear in the coverage list`,
        ).toContain(noRateOrder.internalOrderId);
      });

      // ── Skipped states: mockup captured for reference, real app not reachable ──
      for (const state of ['detail-tax', 'detail-postrollout'] as MockupState[]) {
        await test.step(`${state} (mockup only — see #2855)`, async () => {
          await pages.analyticsMockup.gotoState(state);
          const mockupFile = testInfo.outputPath(`${state}--mockup.png`);
          await pages.analyticsMockup.regionFor(state).screenshot({ path: mockupFile });
          await testInfo.attach(`${state} — mockup (no real-app comparison — #2855)`, {
            path: mockupFile,
            contentType: 'image/png',
          });
        });
      }

      await test.step('currency-failed (mockup only — no flow-driven way to force the driver job to fail)', async () => {
        await pages.analyticsMockup.gotoState('currency-failed');
        const mockupFile = testInfo.outputPath('currency-failed--mockup.png');
        await pages.analyticsMockup.regionFor('currency-failed').screenshot({ path: mockupFile });
        await testInfo.attach('currency-failed — mockup (no real-app comparison)', {
          path: mockupFile,
          contentType: 'image/png',
        });
      });
    } finally {
      if (currencyFixture) {
        await (currencyFixture as CurrencyMismatchFixture).restore().catch((error: unknown) => {
          // eslint-disable-next-line no-console -- MANUAL FOLLOW-UP surfaced to the runner's stdout, the package's own convention for best-effort teardown (see README "What a run leaves behind")
          console.error(
            `MANUAL FOLLOW-UP: failed to restore the reporting currency after the analytics mockup-parity spec — check PUT /currency-settings/reporting-currency by hand. ${String(error)}`,
          );
        });
      }
    }
  });
});
