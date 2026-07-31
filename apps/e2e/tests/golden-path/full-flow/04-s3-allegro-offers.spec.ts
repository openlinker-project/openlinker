/**
 * Golden path full-flow: S3 — Allegro offers
 *
 * Create the offers through the bulk wizard and assert field/amount parity via the OL read.
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
import type { SubmittedOfferParameter } from '../../../src/api/api.types';
import { manualCheckpoint } from '../../../src/support/manual-checkpoint';
import { assertMarketplaceParameterRoundTrip, assertProductFieldParity, offerToParityView } from '../../../src/support/parity';
import { state } from './flow-state';
import { fullFlowSegment } from './segment';
import { requireProduct, skipWhenResuming, resolvePrimaryMapping, createBulkOffers } from './helpers';

fullFlowSegment(() => {
  test('S3 — Allegro offers: create + field/amount parity via OL read', async ({ api, world, pages, poll, env }) => {
    skipWhenResuming(env);
    const testInfo = test.info();
    requireProduct();
    const allegro = world.connectionFor(PlatformType.allegro);
    test.skip(!allegro, 'no Allegro connection on this stack');

    const batchId = await createBulkOffers({ api, world, pages, poll, connectionId: allegro!.id, connectionName: allegro!.name, platform: PlatformType.allegro });
    const mapping = await resolvePrimaryMapping(api, poll, allegro!.id);
    const offer = await api.listings.getOffer(mapping.id);
    state.channelBaseline.set('allegro', offer.availableQuantity);

    // Field parity: price, currency, category id, available quantity via OL's adapter read.
    assertProductFieldParity({
      label: 'OL↔Allegro offer',
      expected: { price: state.product!.price ?? undefined, currency: state.product!.currency ?? 'PLN' },
      actual: offerToParityView(offer),
      // `required: ['price']` - `assertProductFieldParity` skips any field the
      // EXPECTED side does not carry, so a null `state.product.price` silently
      // reduced this parity check to a currency-string comparison. S1 already
      // declares its own `required`; these three call sites did not.
      required: ['price'],
    });

    // Value-level parameter parity (#8): the persisted creation-request snapshot
    // carries the SUBMITTED section-tagged parameter values (#1071 —
    // `request.overrides.parameters`; `platformParams` holds only policy knobs).
    // Only available when THIS run created the offer (batchId set); on the reuse
    // path there is no fresh creation record, so the submitted-side parity is
    // skipped and the marketplace-side round-trip below carries the load.
    let submitted: SubmittedOfferParameter[] = [];
    if (batchId) {
      const batch = await api.listings.getBulkBatch(batchId);
      const record =
        batch.records.find((r) => r.internalVariantId === state.primaryVariant!.id) ??
        batch.records[0];
      expect(record, 'bulk batch exposes a creation record').toBeTruthy();
      const creation = await api.listings.getOfferCreationRecord(allegro!.id, record.id);
      submitted = creation.request?.overrides?.parameters ?? [];

      if (offer.category?.id) {
        const directory = await api.listings.categoryParameters(allegro!.id, offer.category.id);
        expect(directory.length, 'Allegro category exposes parameters').toBeGreaterThan(0);

        const byId = new Map(directory.map((p) => [p.id, p]));
        const attributes = (state.primaryVariant!.attributes ?? {});
        for (const param of submitted) {
          const dirEntry = byId.get(param.id);
          expect(
            dirEntry,
            `submitted parameter ${param.id} exists in the Allegro category directory`,
          ).toBeTruthy();
          if (!dirEntry) continue;
          expect(param.section, `parameter "${dirEntry.name}" section`).toBe(dirEntry.section);
          const carriesValue =
            (param.values?.length ?? 0) > 0 ||
            (param.valuesIds?.length ?? 0) > 0 ||
            !!param.rangeValue;
          expect(carriesValue, `parameter "${dirEntry.name}" carries a submitted value`).toBe(true);
          const masterValue = attributes[dirEntry.name];
          if (typeof masterValue === 'string' && (param.values?.length ?? 0) > 0) {
            expect(
              param.values,
              `parameter "${dirEntry.name}" submitted value matches the master attribute`,
            ).toContain(masterValue);
          }
        }
      }
      if (submitted.length === 0) {
        testInfo.annotations.push({
          type: 'parameter-parity',
          description:
            'creation-request snapshot carries no operator-submitted parameters — value-level ' +
            'parity not applicable for this record (builder-projected values are confirmed via ' +
            'the Allegro manual checkpoint)',
        });
      }
    } else {
      testInfo.annotations.push({
        type: 'reuse',
        description:
          'reused an existing Allegro offer for the driver product (create-if-missing, else ' +
          'reuse) — submitted-parameter parity skipped; marketplace-side round-trip still runs',
      });
    }

    // Marketplace-side round-trip (#1482): the live offer read now carries the
    // parameter values Allegro ACCEPTED. Assert submitted == accepted; on a
    // stack whose API predates #1482 the field is absent — annotate and fall
    // back to the manual checkpoint instead of failing.
    if (offer.parameters !== undefined) {
      expect(
        offer.parameters.length,
        'live Allegro offer carries filled parameters',
      ).toBeGreaterThan(0);
      if (submitted.length > 0) {
        assertMarketplaceParameterRoundTrip('OL↔Allegro', submitted, offer.parameters);
      }
      const condition = offer.parameters.find(
        (p) => p.section === 'offer' && (p.values?.length ?? 0) > 0,
      );
      expect(
        condition,
        'live offer carries at least one filled offer-section parameter (e.g. condition)',
      ).toBeTruthy();
    } else {
      testInfo.annotations.push({
        type: 'parameter-parity',
        description:
          'running API does not expose MarketplaceOffer.parameters (#1482 not deployed) — ' +
          'marketplace-side value parity degraded to the Allegro manual checkpoint',
      });
    }

    await manualCheckpoint(
      testInfo,
      {
        dashboard: 'Allegro seller panel',
        url: 'https://allegro.pl.allegrosandbox.pl/moje-allegro/sprzedaz/oferty',
        expect: [
          'The offer for the primary variant is listed/active',
          'Price, category and every parameter (Brand/Model/condition) match',
          'Available quantity equals the OL baseline',
        ],
        values: {
          offerId: offer.externalId,
          price: `${offer.price.amount} ${offer.price.currency}`,
          availableQuantity: offer.availableQuantity,
          categoryId: offer.category?.id ?? '(unresolved)',
        },
      },
    );
  });
});
