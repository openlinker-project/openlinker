/**
 * Golden path full-flow: S8x — buyer tax id (extension, #1574)
 *
 * Best-effort NIP-on-the-invoice check.
 *
 * Segment of the attended S0-S9 flow across all six systems. The segments share
 * `state` and run in file order in one worker — see `./segment.ts` for the
 * ordering, fail-fast and attended-gate contract, and
 * `docs/manual-testing/e2e-golden-path.md` for the flow itself.
 *
 * WARNING: MUTATING and ATTENDED. Run only via
 * `pnpm --filter @openlinker/e2e test:e2e:full-flow`, in a coordinated session
 * against a stack you control.
 *
 * @module tests/golden-path/full-flow
 */
import { test, expect } from '../../../src/fixtures/test';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireOrder } from './helpers';

fullFlowSegment(() => {
  test('S8x — buyer tax id (NIP) on the invoice, best-effort (extension, #1574)', async ({ api }, testInfo) => {
    requireOrder();
    let checked = 0;
    for (const [platform, invoiceId] of state.invoiceIds) {
      const content = await api.invoices.getContent(invoiceId);
      if (content.buyer.taxId && content.buyer.taxId.value.trim().length > 0) {
        checked += 1;
        expect(content.buyer.taxId.scheme, `${platform} invoice buyer tax id scheme`).toBeTruthy();
        testInfo.annotations.push({
          type: 'buyer-tax-id',
          description: `${platform}: buyer tax id present (${content.buyer.taxId.scheme}: ${content.buyer.taxId.value})`,
        });
      }
    }
    if (checked === 0) {
      testInfo.annotations.push({
        type: 'buyer-tax-id',
        description:
          'no purchase in this run carried a buyer tax id (NIP) — this is expected unless the ' +
          'operator opted into the PAUSE step\'s extensionNipBuyer hint; not a failure',
      });
    }
  });
});
