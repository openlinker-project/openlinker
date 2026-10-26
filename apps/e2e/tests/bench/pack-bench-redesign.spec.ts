/**
 * Pack bench redesign — mockup parity (#3342)
 *
 * For every `data-state` `docs/plans/mockups/pack-bench-redesign.html`
 * defines, drives the REAL `/bench` screen into the equivalent situation and
 * compares it against the mockup — a screenshot of each (for a human) plus
 * real content assertions (for the gate). The mockup is opened from the
 * repo-committed file via `file://`, never the Artifact URL
 * (`docs/frontend-architecture.md § UX Mockups`).
 *
 * `FulfillmentWork` rows cannot be produced through any HTTP endpoint — they
 * require the full OMS routing chain (ADR-054) — so `support/bench-seed.ts`
 * writes the terminal DB state directly, the same documented exception
 * `sales-document-market-seed.ts` uses. Every state re-seeds from a clean
 * slate, so the specs may run in any order.
 *
 * Coverage: 5 of 6 states are fully compared (screenshot + real content) —
 * `working`, `ready`, `unlabelled`, `hold`, `empty`. `locked` is mockup-only:
 * it is a genuine, reachable client state (`BenchIdentityOverlay`'s idle
 * timer), but the timeout is read from `VITE_OL_BENCH_IDLE_TIMEOUT_MS` at
 * BUILD time, so a pre-built e2e stack cannot be made to fire it on demand
 * without waiting out the real production timeout — the same class of gap
 * `analytics/mockup-parity.spec.ts` names for `currency-failed`.
 *
 * @module tests/bench
 */
import type { TestInfo, Page, Locator } from '@playwright/test';
import { test, expect } from '../../src/fixtures/test';
import { readSystemConfig } from '../../src/support/access-control';
import { provisionPacker, seedPackerBrowserSession } from '../../src/support/provision-packer';
import { seedBenchState, clearBenchSeed, type BenchSeedState } from '../../src/support/bench-seed';
import { PackBenchMockupPage } from '../../src/pages/pack-bench-mockup.page';

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

test.describe('pack bench redesign mockup parity (#3342)', () => {
  test.afterAll(async () => {
    await clearBenchSeed();
  });

  test('every reachable mockup state matches the real /bench screen', async ({
    page,
    pages,
    api,
    env,
  }, testInfo) => {
    const config = await readSystemConfig(env);
    test.skip(config.demoMode, 'bench packer provisioning needs an admin-approvable registration, unavailable in demo mode (#1624)');

    const packer = await provisionPacker(env, api);
    test.skip(!packer, 'no packer available — registration disabled or rate-limited on this stack');

    await seedPackerBrowserSession(page.context(), env, packer!.creds);

    const mockupPage = await page.context().newPage();
    pages.packBenchMockup = new PackBenchMockupPage(mockupPage);

    const compared: BenchSeedState[] = ['working', 'ready', 'hold', 'unlabelled'];

    for (const state of compared) {
      await test.step(state, async () => {
        const seed = await seedBenchState(state);
        if (seed === null) throw new Error(`seedBenchState('${state}') unexpectedly returned no fixture`);

        await pages.packBenchMockup.gotoState(state);

        await pages.bench.goto();
        await pages.bench.openParcel(seed.orderReference);

        if (state === 'working' || state === 'ready') {
          await expect(pages.bench.parcel).toContainText(seed.orderReference);
          await expect(pages.bench.parcel).toContainText(seed.buyerName);
        } else if (state === 'hold') {
          await expect(pages.bench.holdReason).toBeVisible();
        } else if (state === 'unlabelled') {
          await expect(pages.bench.parcelClosed).toBeVisible();
          await expect(pages.bench.documentsUnlabelled).toBeVisible();
        }

        await captureBoth(testInfo, pages.packBenchMockup.regionFor(state), page, state);
      });
    }

    await test.step('empty', async () => {
      // The mockup's `empty` pill is labelled "Nothing routed" and its panel
      // is the NOT-ROUTED empty state, not the idle/pipe-healthy one — see
      // `seedBenchState`'s own comment. `seedBenchState('empty')` disables
      // `sourcingAuthority` on the seeded OMS connection to match.
      await seedBenchState('empty');

      // The worklist is INSTALL-WIDE, not scoped to this suite's own rows
      // (`listPackingExecutors()` is unscoped by packer identity — spec D2).
      // On a SHARED stack another connection may still carry accepted work
      // this seed cannot clear (verified live: a demo stack's own
      // pre-existing OMS connection/work rows), in which case the bench can
      // never read empty however this suite's own connection is configured.
      // Skip with a named reason rather than asserting an install-wide fact
      // this fixture cannot guarantee.
      const stillHasWork = (await packer!.client.bench.listWork()).works.length;
      test.skip(
        stillHasWork > 0,
        'bench worklist is not empty on this stack (other connections carry accepted work this seed cannot clear) — the not-routed empty state is unreachable here',
      );

      await pages.packBenchMockup.gotoState('empty');
      await pages.bench.goto();
      await expect(pages.bench.emptyNotRouted).toBeVisible();
      await captureBoth(testInfo, pages.packBenchMockup.regionFor('empty'), page, 'empty');
    });

    await test.step('locked (mockup only — see this file\'s header)', async () => {
      await pages.packBenchMockup.gotoState('locked');
      const mockupFile = testInfo.outputPath('locked--mockup.png');
      await pages.packBenchMockup.regionFor('locked').screenshot({ path: mockupFile });
      await testInfo.attach('locked — mockup (no real-app comparison — see file header)', {
        path: mockupFile,
        contentType: 'image/png',
      });
    });
  });
});
