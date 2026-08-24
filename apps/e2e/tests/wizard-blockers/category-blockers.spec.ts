/**
 * Bulk-offer wizard - category-blocker states (#2240)
 *
 * The operator report this file pins: a three-variant product where one variant
 * listed and two were blocked by a chip reading `manual category`, whose only
 * offered fix - `Fix on base` - could not clear it.
 *
 * Every state is driven through the real wizard (real resolve decoder, real
 * blocker computation, real chip + banner rendering) against a stubbed OL API,
 * so the project needs no seeded catalogue, no Allegro connection and no shared
 * auth artifact - the session bootstrap is stubbed too. Each test writes a named
 * screenshot into its own output directory and attaches it, because this change
 * is mostly about what the operator is told, and an assertion on a string is
 * necessary but not sufficient evidence for that.
 *
 * One case per cause, one per surface, one per destination shape:
 *
 * CAUSES        no catalog match · no barcode · invalid barcode ·
 *               multiple matches · unknown result
 * FIXES         product-tier category (clears every inheriting sibling) ·
 *               per-variant override (clears one, warns about the split) ·
 *               what follows a fix (missing product parameters)
 * SURFACES      Review chips · variant editor · product category bar ·
 *               batch banner · confirmation
 * DESTINATIONS  catalogue-owning (Allegro) · borrowing (Erli-shaped, category
 *               resolved at submit) · grouping that forbids a per-variant category
 *
 * @module tests/wizard-blockers
 */
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';
import {
  CONNECTION_ID,
  CONNECTION_NAME,
  PICKED_CATEGORY_NAME,
  VARIANTS,
  stubResolveStream,
  stubWizardApi,
  wizardUrl,
  type StubOptions,
  type StubVariant,
} from './wizard-stub';

/** Seller defaults complete enough to satisfy the pre-submit check. */
const COMPLETE_SELLER_DEFAULTS = {
  location: { countryCode: 'PL', province: 'MAZOWIECKIE', city: 'Warszawa', postCode: '00-001' },
  responsibleProducerId: 'rp-1',
  safetyInformation: { type: 'TEXT', description: 'Safe.' },
};

/** Most tests are about categories, not seller details - keep that noise off. */
const READY_CONNECTION: StubOptions = { sellerDefaults: COMPLETE_SELLER_DEFAULTS };

/** One sibling with a chosen outcome; the other two matched and out of the way. */
function onlyVariant(outcome: StubVariant['outcome'], ean: string | null): StubVariant[] {
  return [
    { id: 'ol_variant_2240a', size: '20 cm', ean, outcome },
    { id: 'ol_variant_2240b', size: '12 cm', ean: '5900000000138', outcome: 'matched' },
    { id: 'ol_variant_2240c', size: '16 cm', ean: '5900000000145', outcome: 'matched' },
  ];
}

/**
 * Screenshot one state, written under a readable name in the test's own output
 * directory and attached to the report. A named file rather than a `body`
 * attachment, so the evidence for a copy change is reviewable straight off disk.
 */
async function captureState(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = false
): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** Boot the wizard and walk it to a settled Review step, product row expanded. */
async function openReview(page: Page, opts: StubOptions = {}): Promise<void> {
  await stubResolveStream(page, opts);
  await stubWizardApi(page, opts);
  await page.goto(wizardUrl());

  // Configure -> Resolve. The connection + master catalogue arrive from the stub;
  // Allegro still requires a delivery package before Proceed unlocks, which the
  // shared page object knows how to satisfy.
  const wizard = new BulkOfferWizard(page);
  await wizard.expectOnConfigStep();
  await wizard.completePlatformConfig({ requiresDeliveryPolicy: true });
  await wizard.proceedButton.click();

  // Resolve runs in one write (stubbed stream), then Review renders.
  await expect(page.getByText(/need attention|are ready/i).first()).toBeVisible({
    timeout: 30_000,
  });

  await expandProductRow(page);
}

/**
 * A multi-variant product renders collapsed, with aggregate chips; the
 * per-variant causes live in its sub-rows. Idempotent, because saving the editor
 * re-renders Review and the row can return collapsed.
 */
async function expandProductRow(page: Page): Promise<void> {
  const expand = page.getByRole('button', { name: /^Expand Doniczka ceramiczna Terra variants$/ });
  if ((await expand.count()) > 0) await expand.click();
  await expect(page.getByText('Rozmiar: 12 cm').first()).toBeVisible();
}

/** Every chip button in Review whose blocker label matches. */
function chips(page: Page, label: string): Locator {
  return page.getByRole('button', { name: new RegExp(`Fix: ${label} - `) });
}

/** Open the per-product editor from a blocked variant's chip. */
async function openEditorFromChip(page: Page, label: string): Promise<void> {
  await chips(page, label).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('bulk wizard category blockers (#2240)', () => {
  // ── Causes ──────────────────────────────────────────────────────────────────

  test('a barcode absent from the catalogue reads "no catalog match", one chip per variant', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);

    await expect(chips(page, 'no catalog match')).toHaveCount(2);
    await expect(chips(page, 'no catalog match').first()).toHaveAttribute(
      'title',
      new RegExp(`isn't in the ${CONNECTION_NAME} catalog`)
    );
    // The consequence is stated in the editor, not as a constant second chip in a
    // row that already carries up to four.
    await expect(page.getByText('category not set', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ready').first()).toBeVisible();

    await captureState(page, testInfo, 'cause-no-catalog-match', true);
  });

  test('a variant with no barcode reads "no barcode" and is told where to add one', async ({
    page,
  }, testInfo) => {
    await openReview(page, { ...READY_CONNECTION, variants: onlyVariant('no-barcode', null) });

    await expect(chips(page, 'no barcode')).toHaveCount(1);
    await openEditorFromChip(page, 'no barcode');
    await expect(page.getByText('This variant has no barcode.')).toBeVisible();
    await expect(page.getByText(new RegExp(`Add one below so ${CONNECTION_NAME}`))).toBeVisible();

    await captureState(page, testInfo, 'cause-no-barcode');
  });

  test('a barcode failing its check digit reads "invalid barcode", not "no barcode"', async ({
    page,
  }, testInfo) => {
    // 5900000000153 is the 20 cm barcode with its check digit broken, so the GS1
    // gate fires on the master value with no editing at all.
    await openReview(page, {
      ...READY_CONNECTION,
      variants: onlyVariant('no-match', '5900000000153'),
    });

    await expect(chips(page, 'invalid barcode')).toHaveCount(1);
    // The invalid barcode REPLACES the category cause rather than joining it.
    await expect(chips(page, 'no barcode')).toHaveCount(0);
    await expect(chips(page, 'no catalog match')).toHaveCount(0);
    await expect(chips(page, 'invalid barcode').first()).toHaveAttribute(
      'title',
      /5900000000153 isn't a valid barcode/
    );

    await captureState(page, testInfo, 'cause-invalid-barcode', true);
  });

  test('several catalogue cards on one barcode read "multiple matches"', async ({
    page,
  }, testInfo) => {
    await openReview(page, {
      ...READY_CONNECTION,
      variants: onlyVariant('multi-match', '5900000000152'),
    });

    await expect(chips(page, 'multiple matches')).toHaveCount(1);
    await openEditorFromChip(page, 'multiple matches');
    await expect(
      page.getByText(new RegExp(`Several ${CONNECTION_NAME} catalog products share barcode`))
    ).toBeVisible();

    await captureState(page, testInfo, 'cause-multiple-matches');
  });

  test('an outcome this build does not recognise blocks instead of reading ready', async ({
    page,
  }, testInfo) => {
    // The shape a discriminant added backend-first arrives in. Before #2240 the
    // chain had no final `else`, so this produced a READY row with no category.
    await openReview(page, {
      ...READY_CONNECTION,
      variants: onlyVariant('unknown', '5900000000152'),
    });

    await expect(chips(page, 'unknown result')).toHaveCount(1);
    await openEditorFromChip(page, 'unknown result');
    await expect(
      page.getByText(/returned a category result this version doesn't recognise/)
    ).toBeVisible();
    await expect(
      page.getByText(/its answer was not understood, so nothing was ruled out/)
    ).toBeVisible();

    await captureState(page, testInfo, 'cause-unknown-result');
  });

  // ── The editor ──────────────────────────────────────────────────────────────

  test('the editor states cause and consequence, and offers actions that change state', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    await expect(page.getByText('no catalog match').first()).toBeVisible();
    await expect(page.getByText('category not set').first()).toBeVisible();
    await expect(
      page.getByText(
        new RegExp(`isn't in the ${CONNECTION_NAME} catalog, and no category mapping covers`)
      )
    ).toBeVisible();
    await expect(page.getByText(/Barcode 5900000000152/)).toBeVisible();

    await expect(
      page.getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
    ).toBeVisible();
    // `Fix on base` only switched scope; it is gone from this path.
    await expect(page.getByRole('button', { name: 'Fix on base' })).toHaveCount(0);

    await captureState(page, testInfo, 'editor-cause-and-consequence');
  });

  test('the category renders outside the title/description disclosure', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    const disclosure = page.locator('details', {
      has: page.getByText('Override base title / description', { exact: true }),
    });
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure).not.toHaveAttribute('open', /.*/);
    await expect(disclosure).not.toContainText('Category');
    await expect(page.getByRole('button', { name: 'Override for this variant' })).toBeVisible();

    await captureState(page, testInfo, 'editor-category-outside-disclosure');
  });

  test('the product category bar names the action while nothing is set', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    // "set category", not "change": with nothing set, this bar IS the fix every
    // category blocker points at. Scoped to the bar's own label - the banner's
    // primary action reads "Set category for all 3 variants".
    await expect(page.getByRole('button', { name: /^set category/ })).toBeVisible();
    await expect(page.getByText('Not set').first()).toBeVisible();

    await captureState(page, testInfo, 'editor-product-category-bar-unset');
  });

  // ── The fixes ───────────────────────────────────────────────────────────────

  test('setting the product category clears the blocker on every inheriting sibling', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    await page
      .getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
      .click();

    const picker = page.getByRole('dialog').last();
    await expect(picker).toBeVisible();
    await expect(picker.getByText(PICKED_CATEGORY_NAME)).toBeVisible();
    await picker
      .getByRole('button', { name: /^Select$/ })
      .first()
      .click();

    await page.getByRole('button', { name: /save all/i }).click();
    await expandProductRow(page);

    // The defect: before #2240 this stayed at 2 - readiness read the variant tier
    // while the submit pinned the product tier.
    await expect(chips(page, 'no catalog match')).toHaveCount(0);
    await expect(page.getByText(/All included variants are ready/)).toBeVisible();

    await captureState(page, testInfo, 'fix-product-tier-clears-siblings', true);
  });

  test('the per-variant override is offered only once the product has a category', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    // With nothing set on the product, the override is NOT offered - the
    // editor's own save requires a product category (the base schema's
    // `requireCategory` for a browsable destination), so a per-variant-only
    // route would end in a Save refused on a scope the operator never chose.
    await expect(page.getByRole('button', { name: 'Only this variant' })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
    ).toBeVisible();
    // And the copy does not promise it either.
    await expect(page.getByText(/or just for this variant/)).toHaveCount(0);

    await captureState(page, testInfo, 'fix-override-not-offered-before-product-category');
  });

  test('overriding one variant after that warns about the split and clears only that sibling', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);
    await openEditorFromChip(page, 'no catalog match');

    // Product tier first - the only route the editor can save.
    await page
      .getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
      .click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /^Select$/ })
      .first()
      .click();

    // Setting the product category moves the editor to the shared scope, and the
    // bar now names the other action.
    await expect(page.getByRole('button', { name: /^change/ })).toBeVisible();
    await expect(page.getByText(PICKED_CATEGORY_NAME).first()).toBeVisible();

    // Back to the sibling. Its banner is gone with the blocker it described, so
    // the refinement is taken from the category field itself - which is where a
    // rarely-used, consequential override belongs.
    await page.getByRole('radio', { name: /Rozmiar: 20 cm/ }).click();
    await page.getByRole('button', { name: 'Override for this variant' }).click();
    // The consequence is stated before the picker opens - a per-variant category
    // leaves the grouped listing.
    await expect(page.getByText(/splits it into its own Allegro listing/)).toBeVisible();
    await captureState(page, testInfo, 'fix-per-variant-split-warning');

    await page.getByRole('button', { name: 'Override anyway' }).click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /^Select$/ })
      .first()
      .click();

    // The provenance says the value is this variant's own, and what that costs.
    await expect(page.getByText('splits listing').first()).toBeVisible();
    await captureState(page, testInfo, 'fix-per-variant-own-provenance');

    await page.getByRole('button', { name: /save all/i }).click();
    await expandProductRow(page);

    // Every sibling is listable: two inherit the product category, one carries
    // its own - and the one that does will publish outside the grouped listing.
    await expect(chips(page, 'no catalog match')).toHaveCount(0);

    await captureState(page, testInfo, 'fix-per-variant-clears-one', true);
  });

  test('a category with required product parameters asks for them once the card is gone', async ({
    page,
  }, testInfo) => {
    await openReview(page, {
      ...READY_CONNECTION,
      requiredProductParameters: ['Marka', 'Model'],
    });
    await openEditorFromChip(page, 'no catalog match');

    await page
      .getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
      .click();
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /^Select$/ })
      .first()
      .click();
    await page.getByRole('button', { name: /save all/i }).click();
    await expandProductRow(page);

    // The category is set, so the category cause is gone - and what a catalogue
    // card would have supplied is now the operator's to fill.
    await expect(chips(page, 'no catalog match')).toHaveCount(0);
    await expect(chips(page, 'add product params').first()).toBeVisible();

    await captureState(page, testInfo, 'fix-then-missing-parameters', true);
  });

  // ── Destination shapes ──────────────────────────────────────────────────────

  test('a destination that resolves the category at submit shows no category blocker', async ({
    page,
  }, testInfo) => {
    // Erli-shaped: no matcher, no browser, so the resolve pass consulted no
    // catalogue and every `no-match` says nothing about the operator's barcodes.
    await openReview(page, { ...READY_CONNECTION, destination: 'borrowing' });

    await expect(chips(page, 'no catalog match')).toHaveCount(0);
    await expect(page.getByText('category not set', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/All included variants are ready/)).toBeVisible();

    await captureState(page, testInfo, 'destination-resolves-at-submit', true);
  });

  test('an invalid barcode still blocks on a borrowing destination, without a category claim', async ({
    page,
  }, testInfo) => {
    // An invalid barcode is invalid everywhere, so it is deliberately NOT
    // suppressed - but the category IS set server-side here, so no copy may
    // claim otherwise.
    await openReview(page, {
      ...READY_CONNECTION,
      destination: 'borrowing',
      variants: onlyVariant('no-match', '5900000000153'),
    });

    await expect(chips(page, 'invalid barcode')).toHaveCount(1);
    await openEditorFromChip(page, 'invalid barcode');
    await expect(page.getByText(/isn't a valid barcode/)).toBeVisible();
    await expect(page.getByText('category not set', { exact: true })).toHaveCount(0);

    await captureState(page, testInfo, 'destination-invalid-barcode-no-category-claim');
  });

  test('a grouping that forbids a per-variant category offers only the product tier', async ({
    page,
  }, testInfo) => {
    await openReview(page, { ...READY_CONNECTION, destination: 'explicit-group' });
    await openEditorFromChip(page, 'no catalog match');

    await expect(page.getByRole('button', { name: 'Set the product category' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Only this variant' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Override for this variant' })).toHaveCount(0);

    await captureState(page, testInfo, 'destination-product-tier-only');
  });

  // ── Batch-level preconditions ───────────────────────────────────────────────

  test('incomplete seller details lock the submit for the whole batch', async ({
    page,
  }, testInfo) => {
    // No `sellerDefaults`: Allegro's own gate is the first statement of
    // `createOffer`, so every offer would be rejected after submit. Nothing in
    // this batch can succeed, which is why it locks rather than warns.
    await openReview(page);

    await expect(page.getByText(/This connection is missing/)).toHaveCount(1);
    await expect(page.getByText(/a ship-from location/)).toBeVisible();
    await expect(page.getByText(/Allegro requires them on every offer/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open connection settings' })).toHaveAttribute(
      'href',
      new RegExp(CONNECTION_ID)
    );
    for (const cta of await page.getByRole('button', { name: /Create offers/ }).all()) {
      await expect(cta).toBeDisabled();
    }
    await expect(page.getByText(/All included variants are ready/)).toHaveCount(0);

    await captureState(page, testInfo, 'batch-seller-details-missing', true);
  });

  test('an incomplete safety-information type locks the submit too', async ({
    page,
  }, testInfo) => {
    // The mirror used to accept any object under `safetyInformation`, so a
    // connection carrying a description and no `type` read green and had every
    // offer rejected - the drift a mirror falls into (#2240 review).
    await openReview(page, {
      sellerDefaults: {
        ...COMPLETE_SELLER_DEFAULTS,
        safetyInformation: { description: 'Safe.' },
      },
    });

    await expect(page.getByText(/safety information/)).toBeVisible();
    for (const cta of await page.getByRole('button', { name: /Create offers/ }).all()) {
      await expect(cta).toBeDisabled();
    }

    await captureState(page, testInfo, 'batch-seller-details-safety-type-missing', true);
  });

  test('a complete connection carries no batch banner and can submit', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);

    await expect(page.getByText(/This connection is missing/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Create offers/ }).first()).toBeEnabled();

    await captureState(page, testInfo, 'batch-seller-details-complete', true);
  });

  test('a partially filled ship-from location still locks the submit', async ({ page }, testInfo) => {
    // The adapter's gate wants all four location fields, so three of four is a
    // rejection at create time, not something to soften here.
    await openReview(page, {
      sellerDefaults: {
        ...COMPLETE_SELLER_DEFAULTS,
        location: { countryCode: 'PL', province: 'MAZOWIECKIE', city: 'Warszawa' },
      },
    });

    await expect(page.getByText(/a ship-from location/)).toBeVisible();
    await expect(page.getByText(/a responsible producer/)).toHaveCount(0);

    await captureState(page, testInfo, 'batch-seller-details-partial', true);
  });

  // ── The confirmation ────────────────────────────────────────────────────────

  test('the confirmation names variants switched off, and pluralises at one', async ({
    page,
  }, testInfo) => {
    await openReview(page, READY_CONNECTION);

    for (const variant of VARIANTS.filter((v) => v.outcome === 'no-match')) {
      await page
        .getByRole('checkbox', { name: new RegExp(`Include Rozmiar: ${variant.size}`) })
        .uncheck();
    }
    await new BulkOfferWizard(page).createOffersButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/List 1 of 3 selected variants/)).toBeVisible();
    await expect(dialog.getByText(/Not listed: 2 switched off/)).toBeVisible();
    // Singular at one offer - the modal used to say "1 offers".
    await expect(dialog.getByText(/1 offer\b/).first()).toBeVisible();

    await captureState(page, testInfo, 'confirm-switched-off');
  });

  test('the confirmation names variants already listed on the destination', async ({
    page,
  }, testInfo) => {
    // The matched sibling is already there, so the backend excludes it at intake
    // (#1837/#1933) - counting it as an offer would promise work that will not
    // happen. The other two are switched off to get past the readiness gate.
    await openReview(page, { ...READY_CONNECTION, publishedVariantIds: ['ol_variant_2240c'] });

    for (const variant of VARIANTS.filter((v) => v.outcome === 'no-match')) {
      await page
        .getByRole('checkbox', { name: new RegExp(`Include Rozmiar: ${variant.size}`) })
        .uncheck();
    }
    await new BulkOfferWizard(page).createOffersButton.click();

    // The duplicate guard fires first (#1837), then the confirmation.
    const guard = page.getByRole('dialog');
    await expect(guard.getByText(/already on/i).first()).toBeVisible();
    await captureState(page, testInfo, 'confirm-duplicate-guard');
    await guard
      .getByRole('button', { name: /publish remaining|continue|create/i })
      .first()
      .click();

    await expect(
      page.getByRole('dialog').getByText(new RegExp(`1 already on ${CONNECTION_NAME}`))
    ).toBeVisible();

    await captureState(page, testInfo, 'confirm-already-listed');
  });

  test('the readiness gate holds while a blocker stands, and says how many', async ({
    page,
  }, testInfo) => {
    // Review's gate is what normally keeps the blocked count at zero by the time
    // the confirmation opens; the modal's own blocked count exists for the
    // force-exclusion path behind it (asserted in `bulk-confirm-modal.test.tsx`).
    await openReview(page, READY_CONNECTION);

    const wizard = new BulkOfferWizard(page);
    await expect(wizard.createOffersButton).toBeDisabled();
    await expect(page.getByText(/2 variants need attention/)).toBeVisible();

    await captureState(page, testInfo, 'confirm-gate-holds-on-blocked', true);
  });
});
