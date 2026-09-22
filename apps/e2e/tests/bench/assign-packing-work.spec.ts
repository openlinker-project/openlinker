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
 * repo-committed file (never the Artifact URL) for one baseline structural
 * screenshot — see `assign-packing-work-mockup.page.ts`'s header for why its
 * remaining interactive states are not independently re-driven here.
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
    });

    await test.step('place a hold with a reason', async () => {
      await pages.assignPackingWork.placeHold(seed.heldWorkId, 'E2E seeded hold note');
      await expect(pages.assignPackingWork.rowFor(seed.heldWorkId)).toHaveAttribute(
        'data-held',
        'true',
      );
    });

    await test.step('bench-side rendering matches (#3341 rail)', async () => {
      // packerA is the assignee of `seed.assignedWorkId` — their bench must
      // read `assignmentState: 'mine'` (the assigned-to-you badge), never a
      // raw internal user id (the PII-minimization rule #3341's own service
      // docblock states).
      await seedPackerBrowserSession(page.context(), env, packerA!.creds);
      await pages.bench.goto();
      // Scoped to THIS seeded row, not a bare `bench-work-row` selector — a
      // shared stack carries its own pre-existing demo rows, and asserting
      // against every row on the page is a Playwright strict-mode violation
      // the moment more than one exists.
      await expect(pages.bench.rowForWorkId(seed.unassignedWorkId)).toContainText('Assigned to you', {
        timeout: 10_000,
      });
    });
  });
});
