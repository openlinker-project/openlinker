/**
 * Bulk-offer wizard - category-blocker states (#2240)
 *
 * The operator report this file pins: a three-variant product where one variant
 * listed and two were blocked by a chip reading `manual category`, whose only
 * offered fix - `Fix on base` - could not clear it.
 *
 * Every state is driven through the real wizard (real resolve decoder, real
 * blocker computation, real chip + banner rendering) against a stubbed OL API,
 * so it needs no seeded catalogue and no Allegro connection and runs on any
 * stack. Each test also captures a screenshot, attached to the report, because
 * this change is mostly about what the operator is told - a passing assertion on
 * a string is necessary and not sufficient evidence for that.
 *
 * What is asserted, per state:
 *
 * 1. one cause chip per variant in Review, carrying its cause sentence, and no
 *    constant `category not set` chip in the table;
 * 2. cause + consequence together in the variant editor, with actions that
 *    change state;
 * 3. the category control renders outside the title/description disclosure;
 * 4. setting the product-tier category clears the blocker on every sibling that
 *    has no override of its own - the defect itself;
 * 5. a barcode failing its check digit is refused in the field it was typed in
 *    (the `invalid barcode` blocker id itself is a unit-test concern);
 * 6. incomplete Allegro seller details warn once for the batch, before submit;
 * 7. the confirmation names each not-listed reason separately.
 *
 * @module tests/wizard-blockers
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { BulkOfferWizard } from '../../src/pages/bulk-offer-wizard.page';
import {
  CONNECTION_ID,
  VARIANTS,
  stubResolveStream,
  stubWizardApi,
  wizardUrl,
  type StubOptions,
} from './wizard-stub';

/** Seller defaults complete enough to satisfy the pre-submit check. */
const COMPLETE_SELLER_DEFAULTS = {
  location: { countryCode: 'PL', province: 'MAZOWIECKIE', city: 'Warszawa', postCode: '00-001' },
  responsibleProducerId: 'rp-1',
  safetyInformation: { description: 'Safe.' },
};

/**
 * Screenshot one state, written under a readable name in the test's own output
 * directory and attached to the report. A named file rather than a `body`
 * attachment, so the evidence for a copy change is reviewable straight off disk.
 */
async function captureState(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage: boolean
): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** Boot the wizard and walk it to a settled Review step. */
async function openReview(page: Page, opts: StubOptions = {}): Promise<void> {
  await stubResolveStream(page);
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

  // A multi-variant product renders collapsed, with aggregate chips; the
  // per-variant causes live in its sub-rows.
  await page.getByRole('button', { name: /^Expand Doniczka ceramiczna Terra variants$/ }).click();
  await expect(page.getByText('Rozmiar: 12 cm').first()).toBeVisible();
}

/** Open the per-product editor focused on the first blocked sibling. */
async function openEditorOnBlockedVariant(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /Fix: no catalog match/ })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('bulk wizard category blockers (#2240)', () => {
  test('Review shows one cause chip per variant, carrying its cause sentence', async ({
    page,
  }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });

    // Two of three barcodes are absent from the destination catalogue.
    const causeChips = page.getByRole('button', { name: /Fix: no catalog match/ });
    await expect(causeChips).toHaveCount(2);

    // The sentence names the barcode and the destination, and rides on the chip
    // rather than on a second, always-present chip.
    await expect(causeChips.first()).toHaveAttribute('title', /isn't in the Allegro Demo catalog/);
    await expect(page.getByText('category not set', { exact: true })).toHaveCount(0);

    // The matched sibling is ready, so the product is partially listable.
    await expect(page.getByText('ready').first()).toBeVisible();

    await captureState(page, testInfo, 'review-one-cause-chip-per-variant', true);
  });

  test('the editor states cause and consequence, and offers actions that change state', async ({
    page,
  }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });
    await openEditorOnBlockedVariant(page);

    // Cause chip + the derived consequence, side by side.
    await expect(page.getByText('no catalog match').first()).toBeVisible();
    await expect(page.getByText('category not set').first()).toBeVisible();

    // The banner names the offending barcode and the mapping route.
    await expect(
      page.getByText(/isn't in the Allegro Demo catalog, and no category mapping covers/)
    ).toBeVisible();
    // The offending barcode is the one the editor opened on, not a sibling's.
    await expect(page.getByText(/Barcode 5900000000152/)).toBeVisible();

    // Both actions exist; `Fix on base` - which only switched scope - is gone.
    await expect(
      page.getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Only this variant' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fix on base' })).toHaveCount(0);

    await captureState(page, testInfo, 'editor-cause-and-consequence', false);
  });

  test('the category renders outside the title/description disclosure', async ({
    page,
  }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });
    await openEditorOnBlockedVariant(page);

    // The disclosure is closed and no longer named after the category…
    const disclosure = page.locator('details', {
      has: page.getByText('Override base title / description', { exact: true }),
    });
    await expect(disclosure).toHaveCount(1);
    await expect(disclosure).not.toHaveAttribute('open', /.*/);

    // …and the category control is reachable with it closed.
    await expect(page.getByRole('button', { name: 'Override for this variant' })).toBeVisible();

    await captureState(page, testInfo, 'editor-category-outside-disclosure', false);
  });

  test('setting the product category clears the blocker on every inheriting sibling', async ({
    page,
  }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });
    await openEditorOnBlockedVariant(page);

    await page
      .getByRole('button', { name: `Set category for all ${VARIANTS.length} variants` })
      .click();

    // The product-tier picker opens on the shared scope.
    const picker = page.getByRole('dialog').last();
    await expect(picker).toBeVisible();
    await expect(picker.getByText('Doniczki i skrzynki balkonowe')).toBeVisible();
    await picker
      .getByRole('button', { name: /^Select$/ })
      .first()
      .click();

    // Save the editor, then Review re-derives every sibling's blockers.
    await page.getByRole('button', { name: /save all/i }).click();

    // The defect: before #2240 this stayed at 2 - readiness read the variant tier
    // while the submit pinned the product tier.
    await expect(page.getByRole('button', { name: /Fix: no catalog match/ })).toHaveCount(0);

    await captureState(page, testInfo, 'product-tier-category-clears-siblings', true);
  });

  test('a barcode failing its check digit is refused where it was typed', async ({
    page,
  }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });
    await openEditorOnBlockedVariant(page);

    // 5900000000153 is the 20 cm barcode with its check digit broken. The field
    // rejects it in place, so the operator is told before the batch moves - and
    // the blocker it maps to (`invalid-barcode`, distinct from `no-ean` since
    // #2240) is pinned by `bulk-policy.test.ts`, which can assert the id itself
    // rather than a rendering of it.
    await page.getByLabel('EAN for Rozmiar: 20 cm').fill('5900000000153');

    await expect(page.getByText(/Invalid GTIN checksum/)).toBeVisible();

    await captureState(page, testInfo, 'invalid-barcode-refused-in-place', false);
  });

  test('incomplete seller details warn once for the batch, before submit', async ({
    page,
  }, testInfo) => {
    // No `sellerDefaults` on the connection: Allegro's own gate is the first
    // statement of `createOffer`, so every offer would be rejected after submit.
    await openReview(page);

    const banner = page.getByText(/This connection is missing/);
    await expect(banner).toHaveCount(1);
    await expect(page.getByText(/Allegro requires them on every offer/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open connection settings' })).toHaveAttribute(
      'href',
      new RegExp(CONNECTION_ID)
    );

    await captureState(page, testInfo, 'batch-banner-missing-seller-details', true);
  });

  test('the confirmation names each not-listed reason separately', async ({ page }, testInfo) => {
    await openReview(page, { sellerDefaults: COMPLETE_SELLER_DEFAULTS });

    // Switch the two blocked siblings off so the batch is submittable, which is
    // also what gives the confirmation something to report.
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

    await captureState(page, testInfo, 'confirm-names-each-reason', false);
  });
});
