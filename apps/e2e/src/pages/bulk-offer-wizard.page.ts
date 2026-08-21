/**
 * Bulk publish wizard page object (marketplace + shop)
 *
 * Covers `/listings/bulk-create/wizard` — the SetupStepper flow rendered by
 * `bulk/bulk-wizard.tsx`. Since #1754/#1829 this one wizard serves BOTH
 * destination kinds and branches on the connection's capability
 * (`bulk-wizard.tsx:140`):
 *   - marketplace (`OfferCreator`): Config → Resolve → Review → confirm modal →
 *     `/listings/bulk-batches/:batchId`;
 *   - shop (`ProductPublisher`): Config → Review → publish → an in-page
 *     `ShopPublishTracker` (NO batch-progress route).
 * The page title differs accordingly — "Bulk marketplace offer creation" vs
 * "Bulk shop product publishing" (`bulk-wizard.tsx:563`).
 *
 * Step CTAs mirror the real components: "Proceed →" on the config step
 * (`bulk-config-step.tsx:437`), the resolve step auto-advances when its batch
 * queries settle (`bulk-resolve-step.tsx`), and the review step submits via
 * "Create offers (N)" (`bulk-review-step.tsx:251`) / "Publish N listings"
 * (`bulk-shop-review-step.tsx:449`). Both stay disabled while any row needs
 * attention, so the flow fails fast on a non-zero needs-attention count
 * instead of timing out on a disabled button.
 *
 * Review is a product-grouped CSS grid of divs with NO ARIA table/rows
 * (`bulk-review-step.tsx:314+`): `.bulk-review__prow` is one PRODUCT (with
 * `.bulk-review__vrows` sub-rows once expanded), and the edit modal is
 * per-product too (`:400`), so this object walks products, not variants.
 *
 * Destination selection is only shown when more than one eligible connection
 * exists; with a single connection the config step shows "Publishing as {name}"
 * (`bulk-config-step.tsx:235`) and no picker.
 *
 * The per-product edit modal reached from the Review step — and everything
 * inside it (category picking, category-parameter filling) — lives in the
 * sibling `BulkOfferRowEditor`; this object owns one and delegates to it.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';
import { BulkOfferRowEditor, isVisibleWithin } from './bulk-offer-row-editor.page';

/** Upper bound on per-row edits so an unfillable parameter fails loudly, not forever. */
const MAX_ROW_EDITS = 25;

/** Shop-listing visibility on the shop review step (`bulk-shop-review-step.tsx:518-540`). */
export type ShopPublishVisibility = 'draft' | 'published';

export class BulkOfferWizard {
  /**
   * The per-product edit modal driver. One instance per wizard, so the run's
   * category target (stamped once by `advanceToConfirmModal`) is shared by every
   * row edited during this wizard run rather than reset per row.
   */
  private readonly rowEditor: BulkOfferRowEditor;

  constructor(private readonly page: Page) {
    this.rowEditor = new BulkOfferRowEditor(page);
  }

  /** Both wizard variants (`bulk-wizard.tsx:563`) land on the same config step. */
  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', {
        name: /^Bulk (marketplace offer creation|shop product publishing)$/,
      }),
    ).toBeVisible();
  }

  /**
   * The config step's destination picker.
   *
   * #1828 replaced the `<select>` with the shared `PublishDestinationRail`
   * (`bulk-config-step.tsx:222-232`): a `role="radiogroup"` labelled by the
   * "Destination connection" `<label>` (`:223-225`), holding `role="radio"`
   * buttons. Absent when exactly one destination is eligible (`:233-237`).
   */
  get destinationRail(): Locator {
    return this.page.getByRole('radiogroup', { name: 'Destination connection' });
  }

  /**
   * Select the destination if the rail is present (multi-destination).
   *
   * With a single eligible destination the rail is replaced by a
   * "Publishing as {name}" alert (`bulk-config-step.tsx:235`) — assert that it
   * names the expected connection rather than silently continuing against
   * whatever the stack auto-resolved.
   */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if ((await this.destinationRail.count()) > 0) {
      const option = this.destinationRail.getByRole('radio').filter({ hasText: connectionName });
      await expect(
        option,
        `destination "${connectionName}" should be offered on the config step`,
      ).toHaveCount(1, { timeout: 15_000 });
      await option.click();
      await expect(option).toHaveAttribute('aria-checked', 'true');
      return;
    }
    await expect(
      this.page.getByText(`Publishing as ${connectionName}`),
      `single-destination wizard should be publishing as "${connectionName}"`,
    ).toBeVisible({ timeout: 15_000 });
  }

  /** The Allegro platform section's delivery-policy select (`allegro-bulk-config-section.tsx:62`). */
  get deliveryPolicySelect(): Locator {
    return this.page.getByLabel('Shipping rate package');
  }

  /** The Erli section's delivery-price-list select (#1530, `erli-delivery-price-list-field.tsx:103`). */
  get erliDeliveryPriceListSelect(): Locator {
    return this.page.getByLabel('Delivery price list', { exact: true });
  }

  /** The Erli section's responsible-producer select (#1531, `erli-producer-field.tsx:76`). */
  get erliProducerSelect(): Locator {
    return this.page.getByLabel('Producer', { exact: true });
  }

  /**
   * Pick the first real (non-placeholder) option of a lazily-populated,
   * controlled platform-config select and verify the value committed into the
   * form. While its options load from the platform the field renders a
   * disabled placeholder control under the same label, so the enabled-wait
   * doubles as the options-loaded wait.
   */
  private async selectFirstRealOption(select: Locator, assertion: string): Promise<void> {
    await select.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(select).toBeEnabled({ timeout: 30_000 });
    const value = await select.locator('option:not([value=""])').first().getAttribute('value');
    expect(value, assertion).toBeTruthy();
    await select.selectOption(value);
    // Confirm the controlled select actually committed the value into the form.
    await expect(select).toHaveValue(value!);
  }

  /**
   * Complete the required per-platform config the config step gates "Proceed" on.
   * Allegro requires a delivery (shipping-rate) policy; currency auto-defaults to
   * PLN. The Allegro section is lazy-loaded and its select is populated
   * asynchronously from the connection's seller policies, so a one-shot
   * count check right after picking the connection races the mount — when the
   * caller says the platform requires it, WAIT for the select to appear, enable,
   * pick the first real option, and verify the value stuck.
   *
   * Erli (`requiresErliBuyabilityFields`): dispatch time carries its own
   * default, but a BUYABLE offer additionally needs the batch-default delivery
   * price list (#1530) and responsible producer (#1531) — without them Erli
   * lists the product "niekupowalny" ("brak metody dostawy" / missing
   * producer). Both selects fetch their options live from the Erli connection,
   * so pick the first real option of each (mirrors the Allegro policy pick).
   *
   * A shop destination has no platform section at all (`bulk-config-step.tsx:250`),
   * so the default (no flags) path is a no-op for it.
   */
  async completePlatformConfig(
    opts: { requiresDeliveryPolicy?: boolean; requiresErliBuyabilityFields?: boolean } = {},
  ): Promise<void> {
    if (opts.requiresErliBuyabilityFields) {
      await this.selectFirstRealOption(
        this.erliDeliveryPriceListSelect,
        'Erli connection exposes at least one delivery price list',
      );
      await this.selectFirstRealOption(
        this.erliProducerSelect,
        'Erli connection exposes at least one responsible producer',
      );
      return;
    }
    if (!opts.requiresDeliveryPolicy && (await this.deliveryPolicySelect.count()) === 0) {
      return;
    }
    await this.selectFirstRealOption(
      this.deliveryPolicySelect,
      'Allegro connection exposes at least one delivery policy',
    );
  }

  /** The config step's forward CTA ("Proceed →", `bulk-config-step.tsx:437`). */
  get proceedButton(): Locator {
    return this.page.getByRole('button', { name: /^Proceed/ });
  }

  /**
   * The marketplace review step's submit CTA ("Create offers (N)",
   * `bulk-review-step.tsx:245-252`).
   *
   * The SAME label is rendered twice — a desktop CTA in the toolbar
   * (`.bulk-review__cta--top`) and a mobile one at the foot (`:384-391`,
   * `.bulk-review__cta--mobile`, `display:none` above the mobile breakpoint,
   * `index.css:10540`). Both live in the DOM, so a bare
   * `getByRole('button', { name: … })` is a strict-mode violation; scope to the
   * desktop twin and keep the label in `hasText` so a copy change still fails.
   */
  get createOffersButton(): Locator {
    return this.page.locator('button.bulk-review__cta--top', {
      hasText: /^Create offers \(\d+\)$/,
    });
  }

  /**
   * The shop review step's submit CTA ("Publish N listings",
   * `bulk-shop-review-step.tsx:421` / `:449`). Only the desktop twin exists on
   * this step, but it is scoped the same way for symmetry with the marketplace CTA.
   */
  get publishListingsButton(): Locator {
    return this.page.locator('button.bulk-review__cta--top', {
      hasText: /^(Publish \d+ listings?|Publishing…)$/,
    });
  }

  /** The review-step summary strip (`bulk-review-step.tsx:256` / `bulk-shop-review-step.tsx:460`). */
  private get reviewSummary(): Locator {
    return this.page.locator('.bulk-review__summary');
  }

  /**
   * The needs-attention count on the review step.
   *
   * Read from the summary strip's OWN `.attn` cell
   * (`bulk-review-step.tsx:260-263`: `<div class="attn"><span class="n">{n}</span>
   * <span class="lbl">need attention</span></div>`). There is no aria hook on
   * the individual counters, so the class is the only precise selector — but the
   * `hasText` guard pins it to the "need attention" cell, and a missing strip
   * throws instead of reporting a fabricated 0.
   *
   * NOT `getByRole('status').filter({ hasText: /needs? attention/ })`: BOTH the
   * summary strip (`:256`) and the banner below it (`:294`) are `role="status"`
   * and both contain that phrase, so the old locator resolved to the summary and
   * then parsed its LEADING number — the READY count — as the needs-attention
   * count. That silently green-lit a review with unresolved blockers.
   */
  async needsAttentionCount(): Promise<number> {
    const cell = this.reviewSummary.locator('.attn').filter({ hasText: /need attention/ });
    if ((await cell.count()) === 0) {
      throw new Error(
        'Bulk review summary strip is not rendered — cannot read the needs-attention count.',
      );
    }
    const raw = (await cell.first().locator('.n').innerText()).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Bulk review needs-attention counter is not numeric: "${raw}"`);
    }
    return parsed;
  }

  /**
   * The review step's "Only flagged" filter (`bulk-review-step.tsx:277-284`).
   * Its predicate is exactly "this product has an included variant with
   * blockers" (`:149-151`), which is the FE's own definition of a
   * needs-attention row — so driving it is how this object enumerates them
   * rather than guessing from chip text.
   */
  private get onlyFlaggedCheckbox(): Locator {
    return this.page.getByRole('checkbox', { name: 'Only flagged' });
  }

  private async setOnlyFlagged(on: boolean): Promise<void> {
    if ((await this.onlyFlaggedCheckbox.count()) === 0) return;
    await this.onlyFlaggedCheckbox.setChecked(on);
  }

  /**
   * Drive Config → (Resolving) → Review and open the confirm modal.
   *
   * The resolve step runs two batch queries and auto-advances to Review on
   * settle, so the config click is just "Proceed →". At Review, any product
   * flagged "needs attention" is resolved by driving the wizard's OWN per-product
   * edit modal — the bulk wizard is OpenLinker's own UI, so the automated flow
   * fills it fully (required category parameters + description) rather than
   * hard-failing. A fresh, attribute-less product (no auto-prefilled `Stan`) is
   * therefore listable without operator intervention. The fast path (zero
   * needs-attention rows) stays a no-op. Finally "Publish immediately" is
   * asserted checked so the offers are created ACTIVE, not as drafts. (#1481)
   *
   * `gtin` is the driver variant's real barcode; it is stamped into any
   * GTIN/EAN-typed category parameter so Allegro's validator accepts the offer
   * (the generic placeholder is rejected). Absent → the GTIN param falls back to
   * the placeholder (only correct when the category has no GTIN param).
   */
  async advanceToConfirmModal(
    opts: {
      requiresDeliveryPolicy?: boolean;
      requiresErliBuyabilityFields?: boolean;
      gtin?: string;
      categoryPath?: string[];
      categoryId?: string;
      /**
       * Author this markup as the offer description instead of the default
       * placeholder text. Pasted through the editor, so what reaches the payload
       * has already passed the destination's schema (ADR-046 / #2201).
       */
      descriptionMarkup?: string;
    } = {},
  ): Promise<void> {
    this.rowEditor.setCategoryTarget(opts.categoryPath, opts.categoryId);
    await this.completePlatformConfig(opts);
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.createOffersButton).toBeVisible({ timeout: 60_000 });

    await this.resolveNeedsAttentionRows(opts.gtin, opts.descriptionMarkup);
    // Blocker-clearing only edits rows the FE flags "needs attention". A
    // destination whose FE validator does NOT surface missing required category
    // parameters as a blocker (Erli — its only bulk blocker is missing-image;
    // `Stan`/quantity are never blockers, #1096/#1367) therefore leaves a row
    // READY with its required params still empty, and the fast path submits an
    // empty `overrides.parameters` → the marketplace rejects with
    // PARAMETER_REQUIRED (#1481). Allegro DOES surface those as
    // `needs-product-parameters`, so its rows are covered by the loop above.
    // Top up EVERY listable row's required params so both paths are covered.
    await this.fillEveryRowRequiredParameters(opts.gtin, opts.descriptionMarkup);

    // Authoring must be OBSERVED, not assumed. `resolveNeedsAttentionRows`
    // returns immediately when nothing is flagged, so on a stack where the row
    // resolves cleanly the markup would never reach the editor and the offer
    // would publish whatever description the stack already held - a caller
    // asserting "the authored description survived" would then be asserting
    // nothing. Fail here, naming the cause, rather than there.
    if (opts.descriptionMarkup !== undefined) {
      // Asserted on the ACTION, not on a rendered element: the marketplace Review
      // step deliberately shows no description, so there is nothing to read back
      // there. `resolveNeedsAttentionRows` returns immediately when nothing is
      // flagged, so without this a caller asserting "the authored description
      // survived" would be asserting nothing at all on a clean stack. The paste
      // itself is verified inside the editor, where it happens.
      expect(
        this.rowEditor.authoredCount,
        'the description should have been authored into at least one row editor',
      ).toBeGreaterThan(0);
    }

    // `canApprove` also waits out platform parameter resolution (`paramsResolving`).
    await expect(this.createOffersButton).toBeEnabled({ timeout: 30_000 });
    await this.createOffersButton.click();
    // #1837: an included variant that already has an offer here routes through a
    // soft duplicate confirm before the submit modal opens (`bulk-wizard.tsx:521`).
    await this.confirmDuplicateGuardIfPresent();
    await expect(this.confirmModalConfirmButton).toBeVisible();

    // Publish the offers ACTIVE, not as drafts. The config default is already
    // `true`, but assert it explicitly (idempotent) so a changed default can't
    // silently create drafts.
    await this.publishImmediatelyCheckbox.check();
  }

  /**
   * Drive Config → Review → publish for a SHOP destination (#1829).
   *
   * There is no Resolve step and no confirm modal: the shop review step's
   * "Publish N listings" submits straight through the duplicate guard, and the
   * wizard swaps its body for a `ShopPublishTracker` (`bulk-wizard.tsx:583`) —
   * it never navigates to `/listings/bulk-batches/:id`.
   */
  async publishToShop(opts: { visibility?: ShopPublishVisibility } = {}): Promise<void> {
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.publishListingsButton).toBeVisible({ timeout: 60_000 });

    if (opts.visibility) {
      await this.setShopVisibility(opts.visibility);
    }
    // #1842: an out-of-stock line is the shop review's ONLY flag, and it is a
    // SOFT block — it publishes once acknowledged (`bulk-shop-review-step.tsx:566-579`).
    // `canPublish` (`:409-410`) gates on that ack, NOT on the needs-attention
    // count, so there is deliberately no per-row edit loop here: nothing in the
    // shop editor can raise master stock.
    await this.acknowledgeOutOfStockIfPresent();

    await expect(this.publishListingsButton).toBeEnabled({ timeout: 30_000 });
    await this.publishListingsButton.click();
    await this.confirmDuplicateGuardIfPresent();
    await expect(this.shopPublishTracker).toBeVisible({ timeout: 60_000 });
  }

  /** The shop review step's visibility segmented control (`bulk-shop-review-step.tsx:518-540`). */
  async setShopVisibility(visibility: ShopPublishVisibility): Promise<void> {
    const group = this.page.getByRole('group', { name: 'Visibility' });
    const option = group.getByRole('button', {
      name: visibility === 'published' ? 'Published' : 'Draft',
      exact: true,
    });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * Tick the required out-of-stock acknowledgement when the shop review step
   * raises it (`bulk-shop-review-step.tsx:570-579`); no-op otherwise.
   */
  async acknowledgeOutOfStockIfPresent(): Promise<void> {
    const ack = this.page.getByRole('checkbox', { name: /^Publish anyway/ });
    if ((await ack.count()) === 0) return;
    await ack.check();
  }

  /** The in-page shop publish tracker (`shop-publish-tracker.tsx:206`). */
  get shopPublishTracker(): Locator {
    return this.page.locator('section.shop-publish-tracker');
  }

  /** Leave the shop flow (`bulk-wizard.tsx:583`). */
  async finishShopPublish(): Promise<void> {
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
    await this.page.waitForURL(/\/listings$/, { timeout: 30_000 });
  }

  /** Every product row on the review grid (`bulk-review-step.tsx:494-498`). */
  private productRows(): Locator {
    return this.page.locator('.bulk-review__prow');
  }

  /**
   * Every EDITABLE product row — one whose main row exposes an "Edit" button
   * (`bulk-review-step.tsx:603-612`). A product with no variants renders the
   * text "No variant" there instead (`:601`) and is skipped on submit.
   *
   * The review grid carries no ARIA table/row semantics (it is a CSS grid of
   * divs, `:314+`), so the block classes are the only structural hook; the
   * `has:` filter pins the Edit button to the PRODUCT main row so an expanded
   * product's variant sub-rows (`:617-636`, each with their own Edit) don't
   * change the row set.
   */
  private editableProductRows(): Locator {
    return this.productRows().filter({
      has: this.page.locator('.bulk-review__prow-main button.bulk-review__edit'),
    });
  }

  /**
   * Wait until the Review step has SETTLED — i.e. the async per-category
   * parameter schema has resolved and the row blockers reflect it.
   *
   * The wizard gates its submit CTA on `!paramsResolving`
   * (`bulk-review-step.tsx:138-139`), and Allegro's `needs-product-parameters`
   * blocker (`allegro-offer-validation.ts`) only appears AFTER that per-category
   * schema loads — an effect that races the operator landing on Review. So a
   * naive needs-attention read right after "Proceed" can catch the transient
   * limbo of "0 rows need attention, button disabled (still resolving)" and
   * wrongly take the fast path; the blocker then appears and the button stays
   * disabled at "Create offers (0)" forever.
   *
   * The settled state is unambiguous: EITHER the button is enabled (nothing
   * needs attention) OR at least one row explicitly needs attention. Poll until
   * one of those holds before reading the needs-attention count.
   */
  private async waitForReviewSettled(): Promise<void> {
    await expect(async () => {
      const [enabled, attention] = await Promise.all([
        this.createOffersButton.isEnabled(),
        this.needsAttentionCount(),
      ]);
      if (!enabled && attention === 0) {
        throw new Error(
          'Review still resolving: the submit CTA is disabled with no needs-attention rows — ' +
            'the per-category parameter schema has not settled yet.',
        );
      }
    }).toPass({ timeout: 60_000 });
  }

  /**
   * Resolve every "needs attention" product via its edit modal until the
   * needs-attention count reaches 0.
   *
   * The walk is driven by the review step's own "Only flagged" filter rather
   * than by chip-text guesswork: with it on, the rendered product rows ARE
   * exactly the flagged set (`bulk-review-step.tsx:149-151`), so "the first row"
   * is always a real target and a fixed row simply drops out of the list.
   * Bounded, and requires forward progress per edit so a parameter that can't be
   * auto-filled fails loudly (naming the offending row) instead of looping.
   */
  private async resolveNeedsAttentionRows(
    gtin?: string,
    descriptionMarkup?: string,
  ): Promise<void> {
    await this.setOnlyFlagged(true);
    try {
      for (let attempt = 0; attempt < MAX_ROW_EDITS; attempt += 1) {
        await this.waitForReviewSettled();
        const before = await this.needsAttentionCount();
        if (before === 0) return; // settled + submittable (fast path or done).

        const row = this.editableProductRows().first();
        await expect(
          row,
          `a flagged review product should be editable (needsAttention=${before})`,
        ).toBeVisible({ timeout: 15_000 });
        const rowSummary = (await row.innerText()).replace(/\s+/g, ' ').trim();

        await this.rowEditor.fillRowEditor(row, gtin, 'always', { descriptionMarkup });

        // The Save recomputes the row's blockers; require the count to drop so an
        // unfilled required field surfaces here with its row. Re-settle first so a
        // recompute gated behind a (re)loading schema isn't read mid-flight.
        try {
          await expect(async () => {
            await this.waitForReviewSettled();
            expect(await this.needsAttentionCount()).toBeLessThan(before);
          }).toPass({ timeout: 15_000 });
        } catch {
          throw new Error(
            `Editing a review row did not clear its blocker (needsAttention stuck at ${before}). ` +
              `Row: "${rowSummary}". A required field/parameter could not be auto-filled.`,
          );
        }
      }
      const remaining = await this.needsAttentionCount();
      if (remaining > 0) {
        throw new Error(
          `Bulk review still shows ${remaining} row(s) needing attention after ${MAX_ROW_EDITS} edits.`,
        );
      }
    } finally {
      await this.setOnlyFlagged(false);
    }
  }

  /**
   * Top up EVERY listable product's required category parameters via its edit
   * modal, saving only products that actually gained a value. This closes the
   * gap for a destination whose FE surfaces required category params as an
   * editor field but NOT as a review blocker (Erli — #1481): such a row is
   * READY, so the needs-attention loop skips it, yet it still needs `Stan` +
   * the required quantity parameter filled or the marketplace rejects with
   * PARAMETER_REQUIRED. Idempotent for a destination already handled by the
   * needs-attention loop (Allegro): the reopened product's params are restored
   * from the FE stash, the fill finds nothing empty, and the modal is cancelled.
   */
  private async fillEveryRowRequiredParameters(
    gtin?: string,
    descriptionMarkup?: string,
  ): Promise<void> {
    // Reorder-safe: a "Save all" can re-render or reorder the review grid, so
    // iterating `nth(i)` against a pre-captured count could revisit an
    // already-filled row and SKIP another (its required params then surface
    // later as a marketplace PARAMETER_REQUIRED rejection with no local
    // signal). Instead, restart the walk from the top after every actual save:
    // already-complete rows are cheap no-ops (`if-changed` cancels without
    // saving), so each restarted pass permanently completes at least one more
    // row and a full pass with zero saves means every row is topped up.
    await this.setOnlyFlagged(false);
    await this.waitForReviewSettled();
    const maxPasses = (await this.editableProductRows().count()) + 1;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const count = await this.editableProductRows().count();
      let saved = false;
      for (let i = 0; i < count; i += 1) {
        // `descriptionMarkup` IS threaded here: a row with no blocker is never
        // visited by the needs-attention pass, so this is the only walk that
        // reaches it. Safe against the `if-changed` contract because
        // `authorDescription` reports "unchanged" once the value already matches.
        saved = await this.rowEditor.fillRowEditor(
          this.editableProductRows().nth(i),
          gtin,
          'if-changed',
          { descriptionMarkup },
        );
        if (saved) {
          // The save recomputes blockers / re-loads the schema (and may
          // reorder); re-settle, then restart the walk from the top.
          await this.waitForReviewSettled();
          break;
        }
      }
      if (!saved) return;
    }
    throw new Error(
      `Bulk review row top-up did not converge within ${maxPasses} passes — a row keeps ` +
        'reporting empty required parameters after being saved.',
    );
  }

  /**
   * The submit confirmation modal (`bulk-confirm-modal.tsx:77-80`), scoped by
   * its title "Create {N} {marketplace} offers on {connection}?" so it can't be
   * confused with the duplicate guard that may precede it.
   */
  private get confirmModal(): Locator {
    return this.page.getByRole('dialog', { name: /^Create \d+ .* offers on .+\?$/ });
  }

  get confirmModalConfirmButton(): Locator {
    return this.confirmModal.getByRole('button', { name: 'Create offers', exact: true });
  }

  /**
   * The confirm modal's publish toggle (`bulk-confirm-modal.tsx:95-119`).
   *
   * The wrapping `<label>` also contains the tooltip trigger
   * (`aria-label="About publish immediately"`) and the "Uncheck to create
   * everything as drafts." helper, so the checkbox's accessible name is the
   * CONCATENATION of all three — an exact "Publish immediately" match resolves
   * to nothing. Anchor on the prefix instead.
   */
  get publishImmediatelyCheckbox(): Locator {
    return this.confirmModal.getByRole('checkbox', { name: /^Publish immediately\b/ });
  }

  /**
   * Confirm the destination-aware duplicate guard when it opens (#1837,
   * `duplicate-guard-modal.tsx`). It is a soft warning raised between the review
   * CTA and the actual submit whenever an included variant already has a listing
   * on the destination (`bulk-wizard.tsx:521-527` / `:531-541`); no-op otherwise.
   */
  private async confirmDuplicateGuardIfPresent(): Promise<void> {
    const guard = this.page.getByRole('dialog', { name: /already on / });
    if (!(await isVisibleWithin(guard, 2_000))) return;
    await guard
      .getByRole('button', { name: /^(Publish anyway \(creates duplicate\)|Update existing)$/ })
      .click();
    await expect(guard).toBeHidden({ timeout: 15_000 });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
