/**
 * OMS onboarding wizard - every live state, in order (#3458)
 *
 * Drives the real `/settings/packing` wizard through all of its `data-state`s
 * against the real backend, using the mockup's `data-testid`s, and holds each
 * mockup-drawn state to the committed mockup (`assertMockupParity`):
 *
 *   step 1 Confirm -> stock syncing/complete -> 2 sales documents -> 3 packers
 *   (empty, then one added) -> 4 what changes -> 5 automations -> 6 who
 *   decides -> 7 turn on -> waiting for the first order -> first order arrived
 *   -> status on -> stop dialog -> status off.
 *
 * MUTATING, and opt-in through `E2E_OMS_ONBOARDING_WALK=1`: Confirm creates the
 * OpenLinker packing connection and the MAIN warehouse and points the product
 * masters' stock at it; step 3 creates a real `packer` account; step 2 may mark
 * sales documents "not needed"; and packing is turned ON for the length of the
 * walk. The walk ends by stopping packing again, so the stack is left with
 * packing off - but the connection, the warehouse and the packer stay.
 * A stack where packing was already set up (status on or off) is skipped:
 * the wizard opens step 1 only while it never was.
 *
 * `first-order-arrived` needs a fulfilment task newer than the moment packing
 * was turned on. The walk takes the newest real task and moves its `createdAt`
 * to now in the response (nothing is written); a stack with no task at all
 * skips that one state, which the attended golden path reaches for real.
 *
 * @module tests/oms-onboarding
 */
import { test, expect } from '../../src/fixtures/test';
import { isProductMaster, OmsOnboardingPage } from '../../src/pages/oms-onboarding.page';
import { assertMockupParity } from '../../src/support/oms-onboarding-parity';
import { LIVE_ONLY_STATES, type MockupSource } from '../../src/pages/oms-onboarding-mockup.page';

const WALK_ENABLED = process.env.E2E_OMS_ONBOARDING_WALK === '1';

test.describe.configure({ mode: 'serial' });

test.describe('OMS onboarding - the full live walk (#3458)', () => {
  test.skip(!WALK_ENABLED, 'mutating: set E2E_OMS_ONBOARDING_WALK=1 to run the onboarding walk');

  test('should reach every wizard state with the mockup test ids', async ({ page, world }, testInfo) => {
    const masters = world.connections.filter(isProductMaster);
    test.skip(masters.length === 0, 'no product master on this stack');
    test.skip(masters.length > 2, 'v1 packs from one or two product masters; this stack has more');
    const source: MockupSource =
      masters.length === 2
        ? 'two'
        : (['prestashop', 'woocommerce', 'subiekt'] as const).find((s) => s === masters[0].platformType) ??
          'prestashop';
    const wizard = new OmsOnboardingPage(page);
    const visitedLiveStates = new Set<string>();
    const note = async (): Promise<void> => {
      visitedLiveStates.add(await wizard.state());
    };

    await wizard.goto();
    const landing = await wizard.state();
    // The walk starts at step 1, which the wizard only opens while packing was
    // never set up; a stack that has it on or paused lands on the status page.
    test.skip(
      landing === 'status-on' || landing === 'status-off',
      `packing is already set up here (wizard reads ${landing}); run on a stack where it never was`,
    );

    // ── Step 1 ────────────────────────────────────────────────────────────
    if (!landing.startsWith('step-1-')) {
      await wizard.goToStep(1);
    }
    if (['step-1-product-master', 'step-1-two-product-masters'].includes(await wizard.state())) {
      await note();
      await wizard.byTestId('btn-confirm-product-master').click();
    }
    await expect(wizard.root()).toHaveAttribute('data-state', /^step-1-stock-(syncing|complete)$/, {
      timeout: 60_000,
    });
    const stockState = await wizard.state();
    await note();
    await assertMockupParity(
      wizard,
      page,
      {
        source,
        preset: stockState === 'step-1-stock-complete' ? 's1-complete' : 's1-sync',
        mockupState: stockState,
      },
      testInfo,
    );
    await wizard.byTestId('btn-continue-step-1').click();

    // ── Step 2: sales documents (live only) ───────────────────────────────
    await wizard.expectState('step-2-sales-documents');
    await note();
    const continueDocuments = wizard.byTestId('btn-continue-sales-documents');
    if (await continueDocuments.isDisabled()) {
      // No automatic document issuing configured: "not needed" is the way out.
      await wizard.byTestId('btn-step-salesDocuments-skip').click();
      await expect(continueDocuments).toBeEnabled();
    }
    await continueDocuments.click();

    // ── Step 3: packers ───────────────────────────────────────────────────
    await expect(wizard.root()).toHaveAttribute('data-state', /^step-3-packer/);
    if ((await wizard.state()) === 'step-3-packers-empty') {
      await note();
      await assertMockupParity(wizard, page, { source, preset: 's2', mockupState: 'step-2-packers-empty' }, testInfo);
    }
    const login = `e2e-packer-${Date.now().toString(36)}`;
    await wizard.byTestId('input-p-name').fill('E2E Packer 3458');
    await wizard.byTestId('input-p-login').fill(login);
    await wizard.byTestId('input-p-mail').fill(`${login}@openlinker.local`);
    await wizard.byTestId('btn-add-packer').click();
    await expect(wizard.byTestId('packer-created-notice')).toBeVisible();
    await wizard.expectState('step-3-packer-added');
    await note();
    await assertMockupParity(wizard, page, { source, preset: 's2-added', mockupState: 'step-2-packer-added' }, testInfo);
    await wizard.byTestId('btn-continue-step-2').click();

    // ── Step 4: what changes ──────────────────────────────────────────────
    await wizard.expectState('step-4-what-changes');
    await note();
    await expect(wizard.byTestId('btn-continue-step-3')).toBeDisabled();
    await assertMockupParity(wizard, page, { source, preset: 's3', mockupState: 'step-3-what-changes' }, testInfo);
    await wizard.byTestId('input-ack').check();
    await wizard.byTestId('btn-continue-step-3').click();

    // ── Steps 5 and 6 (live only) ─────────────────────────────────────────
    await wizard.expectState('step-5-automations');
    await note();
    await wizard.byTestId('btn-continue-step-5').click();
    await wizard.expectState('step-6-who-decides');
    await note();
    await wizard.byTestId('btn-continue-step-6').click();

    // ── Step 7: turn on ───────────────────────────────────────────────────
    await wizard.expectState('step-7-turn-on');
    await note();
    await assertMockupParity(wizard, page, { source, preset: 's4', mockupState: 'step-4-turn-on' }, testInfo);

    // Make the newest real fulfilment task read as "arrived after turning on",
    // only once the operator is on the waiting screen.
    let arrivedArmed = false;
    let anyTask = false;
    let answersAfterArm = 0;
    await page.route('**/v1/fulfillment/works*', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { works?: Array<Record<string, unknown>>; total?: number };
      anyTask = anyTask || (body.total ?? 0) > 0;
      if (arrivedArmed) answersAfterArm += 1;
      if (!arrivedArmed || !Array.isArray(body.works)) return route.fulfill({ response });
      const now = new Date().toISOString();
      return route.fulfill({ response, json: { ...body, works: body.works.map((w) => ({ ...w, createdAt: now })) } });
    });

    await wizard.byTestId('btn-turn-on').click();
    await wizard.expectState('waiting-first-order');
    await note();
    await assertMockupParity(wizard, page, { source, preset: 'waiting', mockupState: 'waiting-first-order' }, testInfo);

    // ── First order, status on, stop ──────────────────────────────────────
    arrivedArmed = true;
    await expect
      .poll(
        async () => {
          if (answersAfterArm === 0) return 'pending';
          return anyTask ? await wizard.state() : 'no-task';
        },
        { timeout: 60_000 },
      )
      .toMatch(/first-order-arrived|no-task/);
    if ((await wizard.state()) === 'first-order-arrived') {
      await note();
      await assertMockupParity(wizard, page, { source, preset: 'first', mockupState: 'first-order-arrived' }, testInfo);
      await wizard.byTestId('btn-go-to-status').click();
    } else {
      testInfo.annotations.push({
        type: 'skipped-state',
        description: 'first-order-arrived: no fulfilment task on this stack (covered by golden-path.spec.ts)',
      });
      await page.goto('/settings/packing');
    }
    await page.unroute('**/v1/fulfillment/works*');

    await wizard.expectState('status-on');
    await note();
    await assertMockupParity(wizard, page, { source, preset: 'live', mockupState: 'status-on' }, testInfo);

    await wizard.byTestId('btn-ask-stop').click();
    await assertMockupParity(
      wizard,
      page,
      { source, preset: 'live', mockupState: 'dialog-stop-confirm', dialog: true },
      testInfo,
    );
    await wizard.byTestId('btn-stop-now').click();
    await wizard.expectState('status-off');
    await note();
    await assertMockupParity(wizard, page, { source, preset: 'off', mockupState: 'status-off' }, testInfo);

    for (const liveOnly of LIVE_ONLY_STATES) {
      expect(visitedLiveStates, `the walk never reached ${liveOnly}`).toContain(liveOnly);
    }
  });
});
