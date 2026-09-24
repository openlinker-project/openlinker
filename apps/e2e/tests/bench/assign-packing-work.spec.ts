/**
 * Assign Packing Work — E2E coverage (#3343, ADR-074)
 *
 * Drives the real `/fulfillment/assign` staffing board: assign via the
 * "Move to" select (drag-and-drop is deliberately not implemented on the
 * real screen — `assign-packing-work-actions.tsx`'s own docblock states the
 * scope decision), toggle self-serve eligibility, place a hold with a
 * reason, and confirm the resulting state renders correctly both on THIS
 * board and on the pack bench (#3341's `assignmentState` rail).
 *
 * `FulfillmentWork` rows are seeded directly (see `bench-seed.ts`'s header
 * for why), reusing its connection/location/product/variant fixtures.
 * `docs/plans/mockups/assign-packing-work.html` is opened from the
 * repo-committed file (never the Artifact URL) for a baseline structural
 * screenshot, plus one paired screenshot beside each real-app step whose
 * state the mockup's own `[data-demo-state-btn]` switcher can reach (#3362)
 * — see `assign-packing-work-mockup.page.ts`'s header for which two states
 * qualify and why `drag-over` still doesn't.
 *
 * Coverage note (#3385 review): unlike #3384's pack-bench suite, which
 * compares FIVE full-screen states with both screenshot and real content,
 * "parity" here rests almost entirely on the real-app content assertions
 * below — the mockup screenshots are a structural reference alongside them,
 * not an independent state-by-state comparison, because this board has no
 * mutually-exclusive full-screen states to compare in the first place (see
 * the mockup page object's header). A reader should not assume this suite
 * offers the same class of coverage #3384's does.
 *
 * @module tests/bench
 */
import { test, expect } from '../../src/fixtures/test';
import { readSystemConfig } from '../../src/support/access-control';
import { provisionPacker, seedPackerBrowserSession } from '../../src/support/provision-packer';
import { seedBenchState, clearBenchSeed } from '../../src/support/bench-seed';
import {
  seedAssignPackingWork,
  clearAssignPackingWorkSeed,
} from '../../src/support/assign-packing-work-seed';
import { AssignPackingWorkMockupPage } from '../../src/pages/assign-packing-work-mockup.page';

test.describe('Assign Packing Work (#3343)', () => {
  test.afterAll(async () => {
    await clearAssignPackingWorkSeed();
    await clearBenchSeed();
  });

  test('assign, self-serve toggle and hold, verified on the board and on the bench', async ({
    page,
    pages,
    api,
    env,
  }, testInfo) => {
    const config = await readSystemConfig(env);
    test.skip(config.demoMode, 'packer provisioning needs admin-approvable registration, unavailable in demo mode (#1624)');

    const packerA = await provisionPacker(env, api);
    test.skip(!packerA, 'no packer available — registration disabled or rate-limited on this stack');

    // `packerA!.id` (read back from the admin's user list at provisioning
    // time) is what `seedAssignPackingWork` stamps onto `assignedWorkId`'s
    // `assignedToUserId` below. Before trusting that seeded row to prove
    // anything about the bench's `assignmentState: 'mine'` rendering, confirm
    // that id is genuinely the same principal `packerA!.creds` authenticates
    // as — otherwise the round-trip could pass with the two ids merely both
    // being non-null and never actually matching (#3385 review).
    const me = await packerA!.client.auth.me();
    expect(me.id).toBe(packerA!.id);

    // `bench-seed`'s connection/location/product/variant fixtures are a
    // prerequisite FK target for `seedAssignPackingWork` — any state seeds them.
    await seedBenchState('working');
    const seed = await seedAssignPackingWork(packerA!.id);

    // ── Baseline mockup screenshot (structural reference only) ───────────
    const mockupPage = await page.context().newPage();
    pages.assignPackingWorkMockup = new AssignPackingWorkMockupPage(mockupPage);
    await pages.assignPackingWorkMockup.goto();
    const mockupFile = testInfo.outputPath('board--mockup.png');
    await pages.assignPackingWorkMockup.board.screenshot({ path: mockupFile });
    await testInfo.attach('board — mockup', { path: mockupFile, contentType: 'image/png' });

    await pages.assignPackingWork.goto();
    const realFile = testInfo.outputPath('board--real.png');
    await page.screenshot({ path: realFile, fullPage: true });
    await testInfo.attach('board — real app', { path: realFile, contentType: 'image/png' });

    await test.step('unassigned task starts in the Unassigned lane', async () => {
      await expect(pages.assignPackingWork.laneFor('Unassigned')).toContainText(seed.unassignedWorkId);
    });

    await test.step('assign via "Move to" — moves into the packer\'s lane', async () => {
      await pages.assignPackingWork.moveTo(seed.unassignedWorkId, packerA!.creds.username);
      await expect(pages.assignPackingWork.laneFor(packerA!.creds.username)).toContainText(
        seed.unassignedWorkId,
      );
    });

    await test.step('toggle self-serve off on the already-assigned task', async () => {
      const checkbox = pages.assignPackingWork.selfServeCheckbox(seed.assignedWorkId);
      await expect(checkbox).toBeChecked();
      await pages.assignPackingWork.toggleSelfServe(seed.assignedWorkId);
      await expect(checkbox).not.toBeChecked();

      // Paired mockup reference (#3362 switcher, #3385 review).
      await pages.assignPackingWorkMockup.setDemoState('assignment-only');
      const assignmentOnlyFile = testInfo.outputPath('board--mockup-assignment-only.png');
      await pages.assignPackingWorkMockup.board.screenshot({ path: assignmentOnlyFile });
      await testInfo.attach('board — mockup (assignment-only)', {
        path: assignmentOnlyFile,
        contentType: 'image/png',
      });
    });

    await test.step('place a hold with a reason', async () => {
      await pages.assignPackingWork.placeHold(seed.heldWorkId, 'E2E seeded hold note');
      await expect(pages.assignPackingWork.rowFor(seed.heldWorkId)).toHaveAttribute(
        'data-held',
        'true',
      );

      // Paired mockup reference (#3362 switcher, #3385 review).
      await pages.assignPackingWorkMockup.setDemoState('hold-form-open');
      const holdFormFile = testInfo.outputPath('board--mockup-hold-form-open.png');
      await pages.assignPackingWorkMockup.board.screenshot({ path: holdFormFile });
      await testInfo.attach('board — mockup (hold-form-open)', {
        path: holdFormFile,
        contentType: 'image/png',
      });
    });

    await test.step('bench-side rendering matches (#3341 rail)', async () => {
      await seedPackerBrowserSession(page.context(), env, packerA!.creds);
      await pages.bench.goto();
      // Scoped to THIS seeded row, not a bare `bench-work-row` selector — a
      // shared stack carries its own pre-existing demo rows, and asserting
      // against every row on the page is a Playwright strict-mode violation
      // the moment more than one exists.
      //
      // Two rows, two different sources of "packerA is the assignee":
      // `unassignedWorkId` earned the assignment through the real
      // `/fulfillment/assign` UI action above, while `assignedWorkId` was
      // seeded directly into `assignedToUserId` at the top of the test — the
      // one row whose "Assigned to you" reading actually depends on the
      // `packerA!.id === me.id` identity assertion above having been true.
      await expect(pages.bench.rowForWorkId(seed.unassignedWorkId)).toContainText('Assigned to you', {
        timeout: 10_000,
      });
      await expect(pages.bench.rowForWorkId(seed.assignedWorkId)).toContainText('Assigned to you', {
        timeout: 10_000,
      });
    });
  });
});
