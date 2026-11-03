/**
 * OMS onboarding wizard - live step 1 states (#3458)
 *
 * Read-only. The real `/settings/packing` page against the real backend, with
 * only the `GET /v1/connections` answer rewritten (`OmsOnboardingPage.withConnections`)
 * to show the product-master setups a stack does not happen to have: none,
 * two, and one that is not confirmed yet. No write control is clicked: the
 * backend would act on connections the page was not shown.
 *
 * Each state is held to the committed mockup's `data-testid`s
 * (`assertMockupParity`).
 *
 * @module tests/oms-onboarding
 */
import { test, expect } from '../../src/fixtures/test';
import {
  isProductMaster,
  OmsOnboardingPage,
  withoutOmsConnection,
  withoutProductMasters,
  withTwoProductMasters,
} from '../../src/pages/oms-onboarding.page';
import { assertMockupParity } from '../../src/support/oms-onboarding-parity';
import type { MockupSource } from '../../src/pages/oms-onboarding-mockup.page';

const NAMED_SOURCES: readonly MockupSource[] = ['prestashop', 'woocommerce', 'subiekt'];

test.describe('OMS onboarding - live step 1 (#3458)', () => {
  test('should stay on step 1 with no way forward when no product master is connected', async ({
    page,
  }, testInfo) => {
    const wizard = new OmsOnboardingPage(page);
    await wizard.withConnections((connections) => withoutOmsConnection(withoutProductMasters(connections)));
    await wizard.goto();

    await wizard.expectState('step-1-no-product-master');
    await wizard.expectSource('none');
    await expect(wizard.byTestId('alert-no-product-master')).toBeVisible();
    await expect(wizard.byTestId('link-connect-product-master')).toBeVisible();
    await expect(wizard.byTestId('btn-confirm-product-master')).toHaveCount(0);
    await expect(wizard.byTestId('btn-continue-step-1')).toHaveCount(0);

    await assertMockupParity(
      wizard,
      page,
      { source: 'none', preset: 's1', mockupState: 'step-1-no-product-master' },
      testInfo,
    );
  });

  test('should warn about two product masters and allow confirming them', async ({ page, world }, testInfo) => {
    test.skip(!world.connections.some(isProductMaster), 'no product master on this stack to show twice');
    const wizard = new OmsOnboardingPage(page);
    await wizard.withConnections(withTwoProductMasters);
    await wizard.goto();

    await wizard.expectState('step-1-two-product-masters');
    await wizard.expectSource('two');
    await expect(wizard.byTestId('alert-two-product-masters')).toBeVisible();
    await expect(wizard.byTestId('btn-confirm-product-master')).toBeEnabled();

    await assertMockupParity(
      wizard,
      page,
      { source: 'two', preset: 's1', mockupState: 'step-1-two-product-masters' },
      testInfo,
    );
  });

  test('should offer Confirm for one product master that is not set up yet', async ({ page, world }, testInfo) => {
    const master = world.connections.find(isProductMaster);
    test.skip(master === undefined, 'no product master on this stack');
    const wizard = new OmsOnboardingPage(page);
    await wizard.withConnections((connections) =>
      withoutOmsConnection(connections.filter((c) => !isProductMaster(c) || c.id === master!.id)),
    );
    await wizard.goto();

    await wizard.expectState('step-1-product-master');
    const source = NAMED_SOURCES.includes(master!.platformType as MockupSource)
      ? (master!.platformType as MockupSource)
      : 'prestashop';
    if (source === master!.platformType) await wizard.expectSource(source);
    await expect(wizard.byTestId('btn-confirm-product-master')).toBeEnabled();

    await assertMockupParity(wizard, page, { source, preset: 's1', mockupState: 'step-1-product-master' }, testInfo);
  });
});
