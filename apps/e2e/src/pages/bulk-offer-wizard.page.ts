/**
 * Bulk offer wizard page object (Allegro / Erli)
 *
 * Covers `/listings/bulk-create/wizard` → the SetupStepper flow
 * (Config → Resolving → Review → Confirm) rendered by `bulk/bulk-wizard.tsx`,
 * the confirm modal, and the transition to the batch progress page
 * (`/listings/bulk-batches/:batchId`).
 *
 * Step CTAs mirror the real components: "Proceed →" on the config step
 * (`bulk-config-step.tsx`), the resolve step auto-advances when its batch
 * queries settle (`bulk-resolve-step.tsx`), and "Approve all (N)" on the
 * review step opens the confirm modal (`bulk-review-step.tsx`). "Approve all"
 * stays disabled while any row needs attention, so the flow fails fast on a
 * non-zero needs-attention count instead of timing out on a disabled button.
 *
 * Marketplace connection selection is only shown when more than one eligible
 * connection exists; with a single connection the wizard shows "Publishing as
 * {name}" and no select.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { selectOptionByText } from '../support/selectors';
import { BulkBatchProgressPage } from './bulk-batch-progress.page';

/**
 * Dictionary entries that mean "new / unused" condition, matched
 * case-insensitively against a native <select>'s option text. Mirrors the
 * single-offer wizard's `NEW_VALUE_PATTERNS`
 * (`apps/web/.../auto-prefill-parameters.ts`) so the bulk flow prefills the
 * `Stan` (condition) parameter to the same canonical "Nowy" value.
 */
const CONDITION_NEW_PATTERN = /\b(nowy|nowe|nowa|new)\b/i;

/** Upper bound on per-row edits so an unfillable parameter fails loudly, not forever. */
const MAX_ROW_EDITS = 25;
/** Upper bound on fill passes over one row's required parameters (dependent params can appear). */
const MAX_PARAM_PASSES = 10;

export class BulkOfferWizard {
  constructor(private readonly page: Page) {}

  async expectOnConfigStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: 'Bulk marketplace offer creation' }),
    ).toBeVisible();
  }

  get marketplaceConnectionSelect(): Locator {
    return this.page.getByLabel('Marketplace connection');
  }

  /** Select the marketplace connection if the picker is present (multi-connection). */
  async selectConnectionIfPresent(connectionName: string): Promise<void> {
    if (await this.marketplaceConnectionSelect.count()) {
      await selectOptionByText(this.marketplaceConnectionSelect, connectionName);
    }
  }

  /** The Allegro platform section's delivery-policy select ("Shipping rate package"). */
  get deliveryPolicySelect(): Locator {
    return this.page.getByLabel('Shipping rate package');
  }

  /**
   * Complete the required per-platform config the config step gates "Proceed" on.
   * Allegro requires a delivery (shipping-rate) policy; currency auto-defaults to
   * PLN. The Allegro section is lazy-loaded and its select is populated
   * asynchronously from the connection's seller policies, so a one-shot
   * count check right after picking the connection races the mount — when the
   * caller says the platform requires it, WAIT for the select to appear, enable,
   * pick the first real option, and verify the value stuck. No-op otherwise
   * (Erli's dispatch-time section carries its own defaults).
   */
  async completePlatformConfig(opts: { requiresDeliveryPolicy?: boolean } = {}): Promise<void> {
    if (opts.requiresDeliveryPolicy) {
      await this.deliveryPolicySelect.waitFor({ state: 'visible', timeout: 30_000 });
    } else if ((await this.deliveryPolicySelect.count()) === 0) {
      return;
    }
    await expect(this.deliveryPolicySelect).toBeEnabled({ timeout: 30_000 });
    const value = await this.deliveryPolicySelect
      .locator('option:not([value=""])')
      .first()
      .getAttribute('value');
    expect(value, 'Allegro connection exposes at least one delivery policy').toBeTruthy();
    await this.deliveryPolicySelect.selectOption(value!);
    // Confirm the controlled select actually committed the value into the form.
    await expect(this.deliveryPolicySelect).toHaveValue(value!);
  }

  /** The config step's forward CTA ("Proceed →", `bulk-config-step.tsx`). */
  get proceedButton(): Locator {
    return this.page.getByRole('button', { name: /^Proceed/ });
  }

  /** The review step's submit CTA ("Approve all (N)", `bulk-review-step.tsx`). */
  get approveAllButton(): Locator {
    return this.page.getByRole('button', { name: /^Approve all \(\d+\)$/ });
  }

  /**
   * The needs-attention count on the review step (0 when the hint is absent).
   * Rendered as a `role="status"` hint: "N row(s) need attention…".
   */
  async needsAttentionCount(): Promise<number> {
    const hint = this.page.getByRole('status').filter({ hasText: /needs? attention/ });
    if ((await hint.count()) === 0) {
      return 0;
    }
    const text = (await hint.first().innerText()).trim();
    const match = /^(\d+)/.exec(text);
    return match ? Number(match[1]) : 1;
  }

  /**
   * Drive Config → Resolving → Review and open the confirm modal.
   *
   * The resolve step runs two batch queries and auto-advances to Review on
   * settle, so the config click is just "Proceed →". At Review, any row flagged
   * "needs attention" is resolved by driving the wizard's OWN per-row edit modal
   * — the bulk wizard is OpenLinker's own UI, so the automated flow fills it
   * fully (required category parameters + description) rather than hard-failing.
   * A fresh, attribute-less product (no auto-prefilled `Stan`) is therefore
   * listable without operator intervention. The fast path (zero needs-attention
   * rows) stays a no-op. Finally "Publish immediately" is asserted checked so the
   * offers are created ACTIVE, not as drafts. (#1481)
   */
  async advanceToConfirmModal(opts: { requiresDeliveryPolicy?: boolean } = {}): Promise<void> {
    await this.completePlatformConfig(opts);
    await expect(this.proceedButton).toBeEnabled({ timeout: 30_000 });
    await this.proceedButton.click();
    await expect(this.approveAllButton).toBeVisible({ timeout: 60_000 });

    await this.resolveNeedsAttentionRows();

    // `canApprove` also waits out platform parameter resolution (`paramsResolving`).
    await expect(this.approveAllButton).toBeEnabled({ timeout: 30_000 });
    await this.approveAllButton.click();
    await expect(this.confirmModalConfirmButton).toBeVisible();

    // Publish the offers ACTIVE, not as drafts. The config default is already
    // `true`, but assert it explicitly (idempotent) so a changed default can't
    // silently create drafts.
    await this.publishImmediatelyCheckbox.check();
  }

  /** The Review-step DataTable (its sr-only caption is its accessible name). */
  private get reviewTable(): Locator {
    return this.page.getByRole('table', { name: 'Bulk listing review' });
  }

  /**
   * The first review row that needs attention: a listable row (exposes an
   * "Edit" button; a no-variant row shows "No variant" instead) whose status
   * cell is NOT "ready" (ready rows carry a lone "ready" badge, flagged rows
   * carry blocker chips like "add product params").
   */
  private firstNeedsAttentionRow(): Locator {
    return this.reviewTable
      .getByRole('row')
      .filter({ has: this.page.getByRole('button', { name: 'Edit', exact: true }) })
      .filter({ hasNotText: /\bready\b/i })
      .first();
  }

  /**
   * Wait until the Review step has SETTLED — i.e. the async per-category
   * parameter schema has resolved and the row blockers reflect it.
   *
   * The wizard gates "Approve all" on `!paramsResolving`
   * (`bulk-review-step.tsx`), and Allegro's `needs-product-parameters` blocker
   * (`allegro-offer-validation.ts`) only appears AFTER that per-category schema
   * loads — an effect that races the operator landing on Review. So a naive
   * needs-attention read right after "Proceed" can catch the transient limbo of
   * "0 rows need attention, button disabled (still resolving)" and wrongly take
   * the fast path; the blocker then appears and the button stays disabled at
   * "Approve all (0)" forever.
   *
   * The settled state is unambiguous: EITHER the button is enabled (nothing
   * needs attention) OR at least one row explicitly needs attention. Poll until
   * one of those holds before reading the needs-attention count.
   */
  private async waitForReviewSettled(): Promise<void> {
    await expect(async () => {
      const [enabled, attention] = await Promise.all([
        this.approveAllButton.isEnabled(),
        this.needsAttentionCount(),
      ]);
      if (!enabled && attention === 0) {
        throw new Error(
          'Review still resolving: "Approve all" is disabled with no needs-attention rows — ' +
            'the per-category parameter schema has not settled yet.',
        );
      }
    }).toPass({ timeout: 60_000 });
  }

  /**
   * Resolve every "needs attention" review row via the per-row edit modal until
   * the needs-attention count reaches 0. Bounded, and requires forward progress
   * per edit so a parameter that can't be auto-filled fails loudly (naming the
   * offending row) instead of looping. Each pass first waits out the async
   * category-parameter resolution (`waitForReviewSettled`) so a late-appearing
   * platform blocker is never missed.
   */
  private async resolveNeedsAttentionRows(): Promise<void> {
    for (let attempt = 0; attempt < MAX_ROW_EDITS; attempt += 1) {
      await this.waitForReviewSettled();
      const before = await this.needsAttentionCount();
      if (before === 0) return; // settled + approvable (fast path or done).

      const row = this.firstNeedsAttentionRow();
      await expect(
        row,
        `a review row needing attention should be editable (needsAttention=${before})`,
      ).toBeVisible({ timeout: 15_000 });
      const rowSummary = (await row.innerText()).replace(/\s+/g, ' ').trim();

      await this.resolveRowViaEditor(row);

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
  }

  /**
   * Open a row's edit modal, ensure its category resolved, fill the required
   * fields (description + every required, still-empty category parameter), and
   * save. The modal reuses the single-offer wizard's `CategoryPicker` +
   * `CategoryParametersStep`, so the controls are the same primitives.
   */
  private async resolveRowViaEditor(row: Locator): Promise<void> {
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.getByText(/^Edit offer/)).toBeVisible({ timeout: 15_000 });

    await this.ensureCategoryResolved(dialog);
    await this.fillRequiredTextField(dialog, 'Title', 'E2E offer');
    await this.fillRequiredTextField(dialog, 'Description', 'Automated E2E golden-path offer.');
    await this.fillRequiredCategoryParameters(dialog);

    await dialog.getByRole('button', { name: 'Save row' }).click();
    // A successful save closes the modal; a validation error keeps it open.
    try {
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    } catch {
      const errors = await dialog.locator('.form-field__error').allTextContents();
      throw new Error(
        `Bulk edit modal did not close after "Save row" — validation failed: ${
          errors.length ? errors.join('; ') : '(no field errors surfaced)'
        }`,
      );
    }
  }

  /**
   * Guard against an unresolved category. The Allegro (browse-mode) picker shows
   * a resolved id as a prefill row and an unresolved one as an empty category
   * tree — the latter is a distinct, clearly-surfaced failure (the S0 PS→Allegro
   * category mapping didn't apply). Erli (borrows taxonomy) renders a plain
   * "Allegro category ID" input where blank is valid, so only the browse tree is
   * a fault.
   */
  private async ensureCategoryResolved(dialog: Locator): Promise<void> {
    if ((await dialog.locator('.category-tree-browser').count()) > 0) {
      throw new Error(
        'Bulk edit modal shows an EMPTY Allegro category picker (category tree, no resolved id). ' +
          'The PS→Allegro category mapping did not resolve this product — fix the category mapping ' +
          '(S0) before the offer can be created automatically.',
      );
    }
  }

  /**
   * Fill a required top-level text control (Title / Description) when empty.
   * Freshly-provisioned products carry no description, and the modal schema
   * requires a non-empty one, so an empty value would block the save.
   */
  private async fillRequiredTextField(dialog: Locator, label: string, value: string): Promise<void> {
    const field = dialog.getByLabel(label, { exact: true }).first();
    if ((await field.count()) === 0) return;
    if ((await field.inputValue()).trim() !== '') return;
    await field.fill(value);
  }

  /**
   * Fill every required, still-empty category parameter in the edit modal,
   * type-driven and generic (not hardcoded to one category). Re-scans each pass
   * so parameters that appear only after a parent value is set (dependency-gated
   * fields) are also filled. Optional parameters live in a collapsed <details>
   * and are intentionally left untouched — only required params gate submit.
   */
  private async fillRequiredCategoryParameters(dialog: Locator): Promise<void> {
    // Wait out the per-category schema load before deciding there's nothing to
    // fill (the fieldset only appears once parameters resolve).
    await expect(async () => {
      expect(await dialog.getByText('Loading category parameters').count()).toBe(0);
    }).toPass({ timeout: 20_000 });

    const requiredFieldset = dialog.locator(
      'fieldset.category-parameters-step__group:not(.category-parameters-step__group--optional)',
    );

    for (let pass = 0; pass < MAX_PARAM_PASSES; pass += 1) {
      if ((await requiredFieldset.count()) === 0) return; // no required params for this category.
      let filledSomething = false;

      // Native dictionaries (small, single-select) — e.g. `Stan`: prefer "Nowy".
      const selects = requiredFieldset.locator('select.control');
      for (let i = 0; i < (await selects.count()); i += 1) {
        if (await this.fillNativeSelectIfEmpty(selects.nth(i))) filledSomething = true;
      }
      // Free-text parameters.
      const texts = requiredFieldset.locator('input.control[type="text"]');
      for (let i = 0; i < (await texts.count()); i += 1) {
        if (await this.fillTextInputIfEmpty(texts.nth(i))) filledSomething = true;
      }
      // Numeric parameters (scalars + both ends of a range).
      const numbers = requiredFieldset.locator('input.control[type="number"]');
      for (let i = 0; i < (await numbers.count()); i += 1) {
        if (await this.fillNumberInputIfEmpty(numbers.nth(i))) filledSomething = true;
      }
      // Large / multi / custom-value dictionaries rendered as a Combobox.
      const combos = requiredFieldset.locator('button[role="combobox"]');
      for (let i = 0; i < (await combos.count()); i += 1) {
        if (await this.fillComboboxIfEmpty(combos.nth(i))) filledSomething = true;
      }

      if (!filledSomething) return; // steady state — every required control has a value.
    }
  }

  /** Select the best option in an empty native dictionary select (prefer "Nowy"). */
  private async fillNativeSelectIfEmpty(select: Locator): Promise<boolean> {
    if ((await select.inputValue()) !== '') return false;
    const options = select.locator('option');
    const count = await options.count();
    let firstRealValue: string | null = null;
    let newValue: string | null = null;
    for (let i = 0; i < count; i += 1) {
      const option = options.nth(i);
      const value = await option.getAttribute('value');
      if (!value) continue; // skip the "Select…" placeholder (value="").
      if (firstRealValue === null) firstRealValue = value;
      if (CONDITION_NEW_PATTERN.test((await option.innerText()).trim())) {
        newValue = value;
        break;
      }
    }
    const chosen = newValue ?? firstRealValue;
    if (chosen === null) return false;
    await select.selectOption(chosen);
    return true;
  }

  /** Enter a placeholder into an empty free-text parameter. */
  private async fillTextInputIfEmpty(input: Locator): Promise<boolean> {
    if ((await input.inputValue()).trim() !== '') return false;
    await input.fill('E2E');
    return true;
  }

  /** Enter a valid default into an empty numeric parameter (respecting `min`). */
  private async fillNumberInputIfEmpty(input: Locator): Promise<boolean> {
    if ((await input.inputValue()).trim() !== '') return false;
    const min = await input.getAttribute('min');
    await input.fill(min && Number(min) > 1 ? min : '1');
    return true;
  }

  /**
   * Pick the first selectable option in an empty single-select Combobox.
   *
   * A large (filter-first) dictionary renders nothing until the query matches,
   * and its entries can be alphabetic (brands, materials) OR numeric (clothing
   * sizes like 56/62/68) — so a single hardcoded letter probe (the old "a")
   * matches nothing for a numeric dictionary and the fill wrongly reports "no
   * options". Probe a broad alphabet (digits first — numeric dictionaries are
   * common) and stop at the first probe that reveals a real dictionary option.
   * Falls back to committing a custom value for a `customValuesEnabled` field
   * whose dictionary matched nothing. An empty trigger shows its "Pick …"
   * placeholder; a filled one shows the chosen label.
   */
  private async fillComboboxIfEmpty(trigger: Locator): Promise<boolean> {
    if (!/^pick\b/i.test((await trigger.innerText()).trim())) return false; // already has a value.

    await trigger.click();
    // The popover is portaled to the document body — scope to the page, not the dialog.
    const search = this.page.locator('.combobox__search');
    await expect(search).toBeVisible({ timeout: 10_000 });

    const listbox = this.page.getByRole('listbox');
    // Real dictionary rows — exclude the "use as custom value" affordance and
    // any disabled (parent-filtered) rows.
    const realOptions = listbox.locator(
      '[role="option"]:not(.combobox__option--disabled):not(.combobox__option--custom)',
    );
    // Any committable row, including the custom-value affordance (last resort).
    const anyOptions = listbox.locator('[role="option"]:not(.combobox__option--disabled)');

    // Small, non-filter-first dictionaries render every option immediately.
    if (await this.isVisibleWithin(realOptions, 800)) {
      await realOptions.first().click();
      return true;
    }

    // Filter-first dictionary: probe until a real option surfaces.
    const PROBES = '0123456789aeiouymslxrtnkpbcdfgh';
    for (const probe of PROBES) {
      await search.fill(probe);
      if (await this.isVisibleWithin(realOptions, 400)) {
        await realOptions.first().click();
        return true;
      }
    }

    // No dictionary entry matched any probe — commit a custom value if the field
    // offers one (customValuesEnabled renders a "use as custom value" row).
    await search.fill('E2E');
    if (await this.isVisibleWithin(anyOptions, 1_000)) {
      await anyOptions.first().click();
      return true;
    }

    await this.page.keyboard.press('Escape');
    throw new Error(
      'A required Combobox parameter exposed no selectable options after probing digits + ' +
        'letters and a custom value — cannot auto-fill it.',
    );
  }

  /** True if the locator's first match becomes visible within `timeoutMs`. */
  private async isVisibleWithin(locator: Locator, timeoutMs: number): Promise<boolean> {
    return locator
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  get confirmModalConfirmButton(): Locator {
    return this.page.getByRole('dialog').getByRole('button', { name: 'Create offers' });
  }

  get publishImmediatelyCheckbox(): Locator {
    return this.page.getByRole('dialog').getByRole('checkbox', { name: 'Publish immediately' });
  }

  /** Confirm creation in the final modal and land on the batch progress page. */
  async confirmCreation(): Promise<BulkBatchProgressPage> {
    await this.confirmModalConfirmButton.click();
    await this.page.waitForURL(/\/listings\/bulk-batches\/[^/]+$/);
    return new BulkBatchProgressPage(this.page);
  }
}
