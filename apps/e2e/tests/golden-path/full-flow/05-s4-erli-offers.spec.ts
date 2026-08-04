/**
 * Golden path full-flow: S4 — Erli offers
 *
 * Create the offers and assert at mapping level (Erli exposes no offer reader).
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
import { PlatformType } from '../../../src/world/world';
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { assertProductFieldParity, offerToParityView } from '../../../src/support/parity';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, skipWhenResuming, readLiveOfferOrNull, resolvePrimaryMapping, createBulkOffers } from './helpers';

fullFlowSegment(() => {
  test('S4 — Erli offers: create + mapping-level assertions (no OfferReader)', async ({ api, world, pages, poll, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const erli = world.connectionFor(PlatformType.erli);
    test.skip(!erli, 'no Erli connection on this stack');
    // Creating Erli offers is only worth its ~5 min and its failure surface when
    // somebody is going to BUY on Erli — the offers exist to be purchased at the
    // pause, and S5-S9 only track the platforms in `purchasePlatforms`. Without
    // this an `E2E_PURCHASE_PLATFORMS=allegro` run still lists on Erli and dies
    // there whenever the sandbox shop is unavailable (Erli disabled it outright
    // on 2026-07-30), taking down a flow that had no Erli assertion to make.
    test.skip(
      !env.purchasePlatforms.includes(PlatformType.erli),
      `Erli is not in E2E_PURCHASE_PLATFORMS (${env.purchasePlatforms.join(', ')}) — nothing would buy these offers`,
    );

    await createBulkOffers({ api, world, pages, poll, connectionId: erli!.id, connectionName: erli!.name, platform: PlatformType.erli, erliCategoryPath: env.freshAllegroCategoryPath });
    const mapping = await resolvePrimaryMapping(api, poll, erli!.id);

    // Mapping-level assertions: the offer was created and mapped to the primary
    // variant with a marketplace-native external id.
    expect(mapping.externalId, 'Erli mapping carries the marketplace offer id').toBeTruthy();
    expect(mapping.internalId, 'Erli mapping targets the primary variant').toBe(
      state.primaryVariant!.id,
    );

    // Capability-guarded live read: the Erli adapter ships no `OfferReader`, so
    // `GET /listings/:id/offer` 422s — degrade to the mapping-level assertions
    // above instead of failing. (Adapter-side OfferReader is a backend follow-up.)
    const offer = await readLiveOfferOrNull(api, mapping.id);
    if (offer) {
      state.channelBaseline.set('erli', offer.availableQuantity);
      assertProductFieldParity({
        label: 'OL↔Erli offer',
        expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
        actual: offerToParityView(offer),
      // `required: ['price']` - `assertProductFieldParity` skips any field the
      // EXPECTED side does not carry, so a null `state.product.price` silently
      // reduced this parity check to a currency-string comparison. S1 already
      // declares its own `required`; these three call sites did not.
        required: ['price'],
      });
    } else {
      testInfo.annotations.push({
        type: 'capability-degrade',
        description:
          'Erli adapter has no OfferReader — live-offer parity degraded to mapping-level ' +
          'assertions; price/qty/category confirmed via the Erli manual checkpoint',
      });
    }

    const masterAvailability = state.olBaseline!.get(state.primaryVariant!.id);
    await manualCheckpoint(testInfo, {
      dashboard: 'Erli seller panel / storefront',
      expect: [
        'The offer is published (borrowed Allegro taxonomy)',
        'Price and category match the master',
        'Available quantity equals the OL master availability below',
      ],
      values: {
        offerId: mapping.externalId,
        expectedPrice: `${state.product!.price ?? '(master)'} ${state.product!.currency ?? 'PLN'}`,
        expectedAvailability: masterAvailability ?? '(unknown)',
      },
    });
  });
});
