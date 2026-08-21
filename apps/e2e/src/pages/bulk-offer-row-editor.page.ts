/**
 * Bulk wizard per-row edit modal page object
 *
 * Covers the per-product edit modal the bulk wizard's Review step opens
 * (`bulk-edit-modal.tsx:306`) and everything reachable only from inside it: the
 * nested Choose-category modal (`bulk-category-choose-modal.tsx`), the editor's
 * own discard guard (`bulk-edit-modal.tsx:373`), and the type-driven fill of
 * the category-parameter schema (`category-parameters-step.tsx`).
 *
 * Split out of `bulk-offer-wizard.page.ts`: the wizard drives the STEPS, this
 * object drives ONE row's editor. `BulkOfferWizard` owns a single instance and
 * delegates to it, so the per-run category target stamped by
 * `advanceToConfirmModal` is shared by every row the wizard edits — it is not
 * re-read per row.
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Dictionary entries that mean "new / unused" condition, matched
 * case-insensitively against a native <select>'s option text. Mirrors the
 * single-offer wizard's `NEW_VALUE_PATTERNS`
 * (`apps/web/.../auto-prefill-parameters.ts`) so the bulk flow prefills the
 * `Stan` (condition) parameter to the same canonical "Nowy" value.
 */
const CONDITION_NEW_PATTERN = /\b(nowy|nowe|nowa|new)\b/i;

/**
 * Matches an Allegro category parameter that expects the product's barcode —
 * "EAN (GTIN)", "EAN", "GTIN", "Kod EAN". Case-insensitive, matched against the
 * control's `aria-label` (== the parameter name). A GTIN param must carry the
 * product's REAL barcode: the generic text placeholder ("E2E") is rejected by
 * Allegro's validator, stranding the offer (#1481).
 */
const GTIN_PARAM_PATTERN = /\b(gtin|ean)\b/i;

/** Upper bound on fill passes over one row's required parameters (dependent params can appear). */
const MAX_PARAM_PASSES = 10;

/**
 * True if the locator's first match becomes visible within `timeoutMs`.
 *
 * Module-scope (not a method) because both this object and `BulkOfferWizard`
 * need it and it depends on nothing but its arguments.
 */
export function isVisibleWithin(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Current text of a control that may be an `<input>`/`<textarea>` OR a
 * contenteditable rich-text surface (ADR-046). `inputValue()` throws on the
 * latter, so the element kind decides which read is legal.
 */
async function currentText(field: Locator): Promise<string> {
  const isFormControl = await field.evaluate(
    (node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement,
  );
  if (isFormControl) return field.inputValue();
  return (await field.textContent()) ?? '';
}

/**
 * The longest run of text between two tags in a markup string.
 *
 * The one substring that survives into a single DOM text node, which is all that
 * Playwright's `hasText` and `textContent` can see - neither inserts a separator
 * at a block boundary, so a needle spanning `</h1><p>` is unmatchable. Returns
 * `null` when no run is long enough to be distinctive.
 */
export function descriptionMarker(markup: string): string | null {
  const runs = [...markup.matchAll(/>([^<]+)</g)].map((m) => m[1].trim());
  const longest = runs.sort((a, b) => b.length - a.length)[0] ?? '';
  return longest.length >= 8 ? longest : null;
}

export class BulkOfferRowEditor {
  /**
   * How many times this editor actually pasted an authored description.
   *
   * The wizard asserts on it: with the marketplace Review step no longer showing
   * a description, there is no rendered element to check, so the observation has
   * to happen where the action does. Without it, "the authored description
   * survived the validator" would once again be asserting nothing on a stack
   * where no row is flagged.
   */
  authoredCount = 0;

  constructor(private readonly page: Page) {}

  /**
   * Explicit category breadcrumb (ancestor names ending at the leaf) used to
   * drive the per-product `BulkCategoryChooseModal` when the row's category did
   * not auto-resolve. Set per-run by `advanceToConfirmModal`; when unset the
   * picker falls back to first-reachable.
   */
  private categoryPath: string[] | undefined;

  /**
   * Explicit category id for a BORROWS-taxonomy destination (Erli), which ships
   * no category browser and instead exposes a plain "Allegro category ID" text
   * field in the editor (`bulk-edit-modal.tsx:1337-1351`). `categoryPath` cannot
   * drive that field — there is no tree to walk — so the two options are
   * mutually exclusive per destination.
   */
  private categoryId: string | undefined;

  /**
   * Stamp the run's category target. Called once by the wizard before it walks
   * the review rows, so every row the editor opens sees the same target.
   */
  setCategoryTarget(categoryPath: string[] | undefined, categoryId: string | undefined): void {
    this.categoryPath = categoryPath;
    this.categoryId = categoryId;
  }

  /**
   * The per-product edit modal (`bulk-edit-modal.tsx:306`).
   *
   * Scoped by accessible name — Radix labels `DialogContent` from its
   * `DialogTitle`, which reads "Edit offer - {product}" for a marketplace
   * (`:819-821`) and "Edit product - {product}" for a shop (`:2811-2813`).
   * Naming it is required, not cosmetic: the nested Choose-category modal
   * (`:1024`) and the editor's own discard guard (`:373`) are sibling dialogs.
   */
  private get editModal(): Locator {
    return this.page.getByRole('dialog', { name: /^Edit (offer|product)\b/ });
  }

  /**
   * Open a product's edit modal, ensure its category resolved, fill the required
   * fields (title + description + every required, still-empty category
   * parameter), and either always save or save only when something was filled.
   *
   * `save: 'if-changed'` (top-up pass) cancels out of an already-complete
   * product so a ready row with its params intact isn't needlessly re-saved; a
   * previously-saved row restores its values from the row's FE stash, so the
   * fill helpers report "nothing empty" and the modal is dismissed untouched.
   *
   * Returns whether "Save all" was actually clicked (false = cancelled with
   * nothing to change), so the top-up pass can restart its reorder-safe walk
   * only after a save that may have re-rendered the review grid.
   */
  async fillRowEditor(
    row: Locator,
    gtin: string | undefined,
    save: 'always' | 'if-changed',
    opts: { descriptionMarkup?: string } = {},
  ): Promise<boolean> {
    await row
      .locator('.bulk-review__prow-main')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();
    const dialog = this.editModal;
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await this.focusBaseScope(dialog);

    let changed = await this.ensureCategoryResolved(dialog);
    changed = (await this.fillRequiredTextField(dialog, 'Title', 'E2E offer')) || changed;
    changed =
      opts.descriptionMarkup === undefined
        ? (await this.fillRequiredTextField(
            dialog,
            'Description',
            'Automated E2E golden-path offer.',
          )) || changed
        : (await this.authorDescription(dialog, opts.descriptionMarkup)) || changed;
    changed = (await this.fillRequiredCategoryParameters(dialog, gtin)) || changed;

    // Both footer actions are scoped to `.bulk-editor__foot`
    // (`bulk-edit-modal.tsx:998-1021`): the image-add row renders its own
    // "Cancel" (`:1523-1533`, and again per variant at `:2167`), so an
    // unscoped exact match could go ambiguous.
    const footer = dialog.locator('.bulk-editor__foot');
    if (save === 'if-changed' && !changed) {
      await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
      await this.dismissEditorDiscardGuardIfPresent();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      return false;
    }

    await footer.getByRole('button', { name: 'Save all', exact: true }).click();
    // A successful save closes the modal; a validation error keeps it open.
    try {
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    } catch {
      const errors = await dialog
        .locator('.form-field__error, .bulk-editor__ean-err')
        .allTextContents();
      throw new Error(
        `Bulk edit modal did not close after "Save all" — validation failed: ${
          errors.length ? errors.join('; ') : '(no field errors surfaced)'
        }`,
      );
    }
    return true;
  }

  /**
   * Make the shared-base scope the active one.
   *
   * For a MULTI-variant product the editor mounts a scope rail
   * (`role="radiogroup"`, `aria-label="Variant scope selector"`,
   * `bulk-edit-modal.tsx:878-882`) and hides every inactive scope form with
   * `hidden` (`:1224`). Opening from the product main row already starts on
   * "Shared base" (`:481-482`), but a chip-triggered open focuses a variant —
   * so re-select base defensively, because the base scope is where the shared
   * title / description / category parameters live.
   */
  private async focusBaseScope(dialog: Locator): Promise<void> {
    const rail = dialog.getByRole('radiogroup', { name: 'Variant scope selector' });
    if ((await rail.count()) === 0) return; // simple product — single scope.
    const base = rail.getByRole('radio', { name: 'Shared base', exact: true });
    if ((await base.getAttribute('aria-checked')) !== 'true') {
      await base.click();
    }
  }

  /** Confirm the editor's unsaved-edits guard when a Cancel raised it (`bulk-edit-modal.tsx:373-387`). */
  private async dismissEditorDiscardGuardIfPresent(): Promise<void> {
    const guard = this.page.getByRole('dialog', { name: 'Discard changes?' });
    if (!(await isVisibleWithin(guard, 1_000))) return;
    await guard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  }

  /**
   * Ensure the product's category is resolved so its parameter schema can load.
   *
   * #1741 moved category selection OUT of the editor body: a browsable
   * destination now shows a Category chip whose crumb is a
   * `aria-label="Change category"` button (`bulk-edit-modal.tsx:849-856`) that
   * opens the nested `BulkCategoryChooseModal`; the inline `CategoryPicker` /
   * `.category-tree-browser` is gone. Three states reach the parameter schema:
   *
   * 1. **Auto-resolved** (Allegro, and any row whose EAN/mapping resolved in the
   *    Resolve step): the chip renders a breadcrumb and no "Category is
   *    required" warning — nothing to pick.
   * 2. **Operator-picked** (a browsable destination whose preview came back
   *    `no-match`): the chip reads "Not set" and carries the warning triangle
   *    (`:860-871`); drive the Choose-category modal the way an operator does.
   * 3. **Borrowed taxonomy** (Erli, `canBrowseCategories === false`): NO chip
   *    button and NO modal — the base form exposes a plain "Allegro category ID"
   *    text field instead (`:1337-1351`), which is optional (blank ⇒ the
   *    category is resolved server-side from the configured mappings at submit,
   *    #1045/#1096). A caller that needs the parameter schema for that
   *    destination must pass `categoryId`; a `categoryPath` cannot drive a
   *    picker that does not exist, so passing one throws rather than silently
   *    leaving the category unset.
   */
  private async ensureCategoryResolved(dialog: Locator): Promise<boolean> {
    // Anything that means "the category-parameters query is no longer pending":
    // the rendered fieldset (`category-parameters-step.tsx:144`), the in-flight
    // "Loading…" line, the resolved-but-empty line, OR the query-error Alert
    // (`bulk-edit-modal.tsx:1653-1668`). The error state is in the union ONLY so
    // the wait short-circuits instead of burning its full timeout — every caller
    // immediately rejects it via `assertCategoryParametersLoaded`, because a
    // failed query is NOT a resolved schema.
    const paramsSettled = dialog
      .locator('fieldset.category-parameters-step__group')
      .or(dialog.getByText('Loading category parameters'))
      .or(dialog.getByText('No category parameters required'))
      .or(this.categoryParametersError(dialog));

    const changeCategoryButton = dialog.getByRole('button', { name: 'Change category' });
    if ((await changeCategoryButton.count()) === 0) {
      // Borrowed-taxonomy destination — inline id field, no browser.
      if (this.categoryPath && this.categoryPath.length > 0) {
        throw new Error(
          'A categoryPath was supplied but this destination ships no category browser ' +
            '(canBrowseCategories === false) — its editor only exposes the "Allegro category ID" ' +
            'text field. Pass `categoryId` instead of `categoryPath` for this destination.',
        );
      }
      if (this.categoryId) {
        const field = dialog.getByLabel('Allegro category ID', { exact: true });
        await expect(
          field,
          'the borrowed-taxonomy editor should expose an "Allegro category ID" field',
        ).toHaveCount(1, { timeout: 10_000 });
        await field.fill(this.categoryId);
        const settled = await isVisibleWithin(paramsSettled, 20_000);
        await this.assertCategoryParametersLoaded(dialog);
        if (settled) return true;
        throw new Error(
          `Filling the Allegro category ID "${this.categoryId}" never surfaced a parameter ` +
            'schema — the category-parameters query for that id did not resolve.',
        );
      }
      // Blank is a supported operator choice (resolve at submit); no schema loads.
      return false;
    }

    const categoryMissing = dialog.getByRole('img', { name: 'Category is required' });
    // Picking a category IS an edit. Reported so `fillRowEditor`'s `if-changed`
    // mode saves it: a row whose category only resolved here, and whose required
    // params then all came pre-filled, used to be CANCELLED — discarding the
    // pick. The submit then carried no category, the server resolved its own
    // from the mappings, and its required params (never shown in this editor)
    // came back as PARAMETER_REQUIRED.
    let picked = false;
    if ((await categoryMissing.count()) > 0) {
      await changeCategoryButton.click();
      await this.pickCategoryInChooseModal(this.categoryPath);
      picked = true;
    }

    const settled = await isVisibleWithin(paramsSettled, 20_000);
    await this.assertCategoryParametersLoaded(dialog);
    if (settled) return picked;

    throw new Error(
      'The bulk edit modal never surfaced a category parameter schema. The category is either ' +
        'still unset or its category-parameters query never resolved.',
    );
  }

  /**
   * The edit modal's category-parameters FAILURE state (`bulk-edit-modal.tsx:1657-1661`).
   * Its own copy — "You can still save - the worker may reject if required params
   * are missing" — is why it must never be read as a resolved schema.
   */
  private categoryParametersError(dialog: Locator): Locator {
    return dialog.getByText('Could not load category parameters');
  }

  /**
   * Reject the edit modal's category-parameters error state.
   *
   * `BaseParameterSection` has four states (`bulk-edit-modal.tsx:1653-1668`) and
   * only three of them mean the schema resolved. Treating the fourth — the
   * `parametersQuery.error` Alert — as "resolved" is a silent failure with a very
   * long fuse: `fillRequiredCategoryParameters` then finds no required fieldset,
   * the wizard submits `parameters: []`, and the run dies ~120 s later as an
   * opaque marketplace PARAMETER_REQUIRED rejection with nothing pointing back at
   * the FE query that 500'd. Same class as the `needsAttentionCount` fix in
   * `BulkOfferWizard`.
   *
   * A `count()` rather than a visibility wait: every call site has already waited
   * out the pending state, so the Alert is either mounted at this instant or the
   * query succeeded.
   */
  private async assertCategoryParametersLoaded(dialog: Locator): Promise<void> {
    if ((await this.categoryParametersError(dialog).count()) === 0) return;
    throw new Error(
      'The bulk edit modal reported "Could not load category parameters" — its ' +
        'category-parameters query failed, so no required parameter can be read or filled. ' +
        'The modal lets an operator save anyway, but the submit would be rejected ' +
        'marketplace-side with PARAMETER_REQUIRED.',
    );
  }

  /**
   * Drive `BulkCategoryChooseModal` (`bulk-category-choose-modal.tsx`) to pick a
   * leaf category.
   *
   * With an explicit breadcrumb, each non-final name is drilled via its
   * `aria-label="Browse into {name}"` button (`:219`) and the final one is
   * picked via its row's "Select" button (`:212`). Without one, drills the first
   * browsable child at each level until a selectable leaf is reachable. Bounded
   * by tree depth so an unexpectedly childless level fails loudly rather than
   * looping.
   */
  private async pickCategoryInChooseModal(categoryPath?: string[]): Promise<void> {
    const modal = this.page.getByRole('dialog', { name: /^Choose category/ });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await this.waitForCategoryLevelSettled(modal);

    if (categoryPath && categoryPath.length > 0) {
      await this.drillCategoryPath(modal, categoryPath);
    } else {
      await this.selectFirstReachableCategoryLeaf(modal);
    }
    // Picking a leaf closes the modal (`bulk-category-choose-modal.tsx:111-114`).
    await expect(modal).toBeHidden({ timeout: 15_000 });
  }

  /**
   * Drill the Choose-category modal along an explicit breadcrumb of node names.
   * Each node row is `li.bulk-editor__catpick-item` (`:190-199`); the button
   * click is scoped to the matching row so it targets the right node.
   */
  private async drillCategoryPath(modal: Locator, path: string[]): Promise<void> {
    for (let i = 0; i < path.length; i += 1) {
      const name = path[i];
      const isLeaf = i === path.length - 1;
      const row = modal
        .locator('li.bulk-editor__catpick-item')
        .filter({ has: this.page.getByText(name, { exact: true }) })
        .first();
      await expect(
        row,
        `category node "${name}" (depth ${i}) should be present in the Choose-category modal`,
      ).toBeVisible({ timeout: 15_000 });
      if (isLeaf) {
        // A leaf already carrying this selection renders "Selected" (`:212`).
        await row.getByRole('button', { name: /^Select(ed)?$/ }).click();
        return;
      }
      await row.getByRole('button', { name: `Browse into ${name}`, exact: true }).click();
      await this.waitForCategoryLevelSettled(modal);
    }
  }

  /** Drill the first browsable child at each level until a leaf's "Select" is reachable. */
  private async selectFirstReachableCategoryLeaf(modal: Locator): Promise<void> {
    for (let depth = 0; depth < 12; depth += 1) {
      const selectButton = modal.getByRole('button', { name: /^Select(ed)?$/ }).first();
      if (await isVisibleWithin(selectButton, 1_500)) {
        await selectButton.click();
        return;
      }
      const browseButton = modal.locator('button[aria-label^="Browse into"]').first();
      if (!(await isVisibleWithin(browseButton, 1_500))) {
        throw new Error(
          `Category level ${depth} has neither a selectable leaf nor a browsable child — ` +
            'cannot pick a category.',
        );
      }
      await browseButton.click();
      await this.waitForCategoryLevelSettled(modal);
    }
    throw new Error('Could not reach a selectable category leaf within 12 levels.');
  }

  /**
   * Wait out the Choose-category modal's per-level fetch so the next scan sees
   * the new level. The modal renders `LoadingState title="Loading categories"`
   * while `useAllegroCategoriesQuery` is in flight
   * (`bulk-category-choose-modal.tsx:176`); a cached level never shows it.
   */
  private async waitForCategoryLevelSettled(modal: Locator): Promise<void> {
    const loading = modal.getByText('Loading categories');
    await isVisibleWithin(loading, 1_000);
    await expect(async () => {
      expect(await loading.count()).toBe(0);
    }).toPass({ timeout: 15_000 });
  }

  /**
   * Fill a required top-level text control (Title / Description) when empty.
   * Freshly-provisioned products carry no description, and the modal schema
   * requires a non-empty one, so an empty value would block the save. Returns
   * true when it actually wrote a value.
   *
   * `exact: true` is load-bearing: the editor also renders per-variant override
   * fields named "Title for {variant}" / "Description for {variant}"
   * (`bulk-edit-modal.tsx`), which a substring match would sweep in. The base
   * controls' names come from `FormField`'s `<label htmlFor>` and the base
   * editor's `aria-label="Description"`.
   *
   * Since ADR-046 the Description is a contenteditable rich-text surface rather
   * than a textarea, which splits the two operations this helper performs:
   * `fill()` still works (Playwright supports contenteditable), but
   * `inputValue()` THROWS on a non-input element. So emptiness is read from text
   * content when the target is not a form control. Getting this wrong fails the
   * whole golden path on a step that looks unrelated to descriptions.
   */
  private async fillRequiredTextField(
    dialog: Locator,
    label: string,
    value: string,
  ): Promise<boolean> {
    const field = dialog.getByLabel(label, { exact: true }).first();
    if ((await field.count()) === 0) return false;
    if ((await currentText(field)).trim() !== '') return false;
    await field.fill(value);
    return true;
  }

  /**
   * Replace the description with authored MARKUP, via a real clipboard paste.
   *
   * `fill()` cannot do this: on a contenteditable it inserts the string as TEXT,
   * so `<b>` would reach the marketplace as four visible characters. A paste is
   * also the honest path - it round-trips through the editor's schema exactly as
   * an operator's paste does, so a tag the destination rejects is dropped here
   * rather than surviving into the payload (ADR-046).
   */
  private async authorDescription(dialog: Locator, markup: string): Promise<boolean> {
    const field = dialog.getByLabel('Description', { exact: true }).first();
    if ((await field.count()) === 0) return false;
    // Report whether this actually CHANGED anything, so the caller's `if-changed`
    // contract still holds - an unconditional `true` makes the top-up walk (which
    // MUST pass the markup, since it is the only walk that visits an unflagged
    // row) exhaust its pass budget and throw about required parameters.
    //
    // The comparison is a MARKER inside one text node, not the whole value
    // stripped of tags: `textContent` inserts nothing at a block boundary, so
    // `<h1>A</h1><p>B</p>` reads as `AB` and any tag-to-space expectation can
    // never match. A marker also makes "unchanged" mean "we authored this" rather
    // than "the same words happened to be here as plain text" - which is why the
    // callers mint it per run.
    const marker = descriptionMarker(markup);
    if (marker !== null && (await currentText(field)).includes(marker)) return false;
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.evaluate((el, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', html.replace(/<[^>]+>/g, ' '));
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, markup);
    // Verified in place, at the point of action: a synthetic paste that the
    // editor ignored would otherwise leave the old value and every downstream
    // assertion would be about the wrong text.
    if (marker !== null) {
      await expect(field, 'the pasted description should reach the editor').toContainText(marker);
    } else {
      await expect(field).not.toBeEmpty();
    }
    this.authoredCount += 1;
    return true;
  }

  /**
   * Fill every required, still-empty category parameter in the edit modal,
   * type-driven and generic (not hardcoded to one category). Re-scans each pass
   * so parameters that appear only after a parent value is set (dependency-gated
   * fields) are also filled. Optional parameters live in a collapsed <details>
   * and are intentionally left untouched — only required params gate submit.
   * Returns true when it wrote at least one value.
   *
   * Scoped to the BASE scope's `CategoryParametersStep`
   * (`category-parameters-step.tsx:144`), which is where the shared parameter
   * values live; per-variant overrides (`bulk-edit-modal.tsx:2180-2200`) inherit
   * from it and are intentionally left alone.
   */
  private async fillRequiredCategoryParameters(dialog: Locator, gtin?: string): Promise<boolean> {
    // Wait out the per-category schema load before deciding there's nothing to
    // fill (the fieldset only appears once parameters resolve).
    await expect(async () => {
      expect(await dialog.getByText('Loading category parameters').count()).toBe(0);
    }).toPass({ timeout: 20_000 });
    // The query can also settle into its ERROR state — including on a re-fetch
    // after the category changed inside this same modal, which is past every
    // check `ensureCategoryResolved` made. "No required params" and "the schema
    // never loaded" look identical from here, so reject the latter explicitly.
    await this.assertCategoryParametersLoaded(dialog);

    const requiredFieldset = dialog.locator(
      'fieldset.category-parameters-step__group:not(.category-parameters-step__group--optional)',
    );
    // The required fieldset mounts a tick after the "Loading…" text clears, so a
    // bare count check here races the render and can wrongly conclude "no
    // required params" (submitting empty `parameters`). Give the resolved schema
    // a bounded moment to mount before scanning; if it never appears the pass
    // loop below still exits cheaply.
    await isVisibleWithin(requiredFieldset, 5_000);

    let filledAny = false;
    for (let pass = 0; pass < MAX_PARAM_PASSES; pass += 1) {
      if ((await requiredFieldset.count()) === 0) return filledAny; // no required params.
      let filledSomething = false;

      // Native dictionaries (small, single-select) — e.g. `Stan`: prefer "Nowy".
      const selects = requiredFieldset.locator('select.control');
      for (let i = 0; i < (await selects.count()); i += 1) {
        if (await this.fillNativeSelectIfEmpty(selects.nth(i))) filledSomething = true;
      }
      // Free-text parameters. A GTIN/EAN param gets the product's real barcode
      // (Allegro rejects a placeholder); everything else gets the placeholder.
      const texts = requiredFieldset.locator('input.control[type="text"]');
      for (let i = 0; i < (await texts.count()); i += 1) {
        if (await this.fillTextInputIfEmpty(texts.nth(i), gtin)) filledSomething = true;
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

      filledAny = filledAny || filledSomething;
      if (!filledSomething) {
        return filledAny; // steady state — every required control has a value.
      }
    }
    return filledAny;
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

  /**
   * Fill an empty free-text parameter. A GTIN/EAN-typed param (detected by its
   * `aria-label`, which mirrors the parameter name) gets the product's REAL
   * barcode when one is available — Allegro's validator rejects a placeholder
   * GTIN and strands the offer (#1481). Every other text param gets the generic
   * placeholder. When a GTIN param is present but no barcode was threaded in, it
   * still falls back to the placeholder (surfaced downstream as an Allegro
   * rejection rather than silently mis-filling).
   */
  private async fillTextInputIfEmpty(input: Locator, gtin?: string): Promise<boolean> {
    if ((await input.inputValue()).trim() !== '') return false;
    const label = (await input.getAttribute('aria-label')) ?? '';
    const value = gtin && GTIN_PARAM_PATTERN.test(label) ? gtin : 'E2E';
    await input.fill(value);
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
   * whose dictionary matched nothing.
   */
  private async fillComboboxIfEmpty(trigger: Locator): Promise<boolean> {
    if (!(await this.isComboboxEmpty(trigger))) return false;

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
    if (await isVisibleWithin(realOptions, 800)) {
      await realOptions.first().click();
      return true;
    }

    // Filter-first dictionary: probe until a real option surfaces.
    const PROBES = '0123456789aeiouymslxrtnkpbcdfgh';
    for (const probe of PROBES) {
      await search.fill(probe);
      if (await isVisibleWithin(realOptions, 400)) {
        await realOptions.first().click();
        return true;
      }
    }

    // No dictionary entry matched any probe — commit a custom value if the field
    // offers one (customValuesEnabled renders a "use as custom value" row).
    await search.fill('E2E');
    if (await isVisibleWithin(anyOptions, 1_000)) {
      await anyOptions.first().click();
      return true;
    }

    await this.page.keyboard.press('Escape');
    throw new Error(
      'A required Combobox parameter exposed no selectable options after probing digits + ' +
        'letters and a custom value — cannot auto-fill it.',
    );
  }

  /**
   * Decide whether a required Combobox parameter still has NO value.
   *
   * Two of the trigger's three bodies are structurally decisive
   * (`combobox.tsx:272-292`): a multi-select with picks renders
   * `span.combobox__chips`, and a committed custom value renders
   * `span.combobox__custom-value`. Neither can exist while the field is empty.
   *
   * The third, `span.combobox__summary`, is ambiguous by construction — it holds
   * the PLACEHOLDER when `value` is null and the chosen option's LABEL otherwise
   * (`formatTriggerSummary`, `:445-456`). There is no `data-empty` / distinguishing
   * class, so the copy is the only discriminator available. Rather than sniff for
   * a hardcoded word, derive the exact placeholder the FE must render: the same
   * call site passes `ariaLabel={parameter.name}` and
   * `placeholder={`Pick ${parameter.name.toLowerCase()}`}`
   * (`category-parameters-step.tsx:277-279`), so an empty trigger reads exactly
   * "Pick {aria-label lowercased}"; a control mounted with no placeholder falls
   * back to the shared default "Select…" (`combobox.tsx:449`, `:455`).
   *
   * A label that still LOOKS like placeholder copy but doesn't match either form
   * throws instead of being read as a value. That is the whole point: rename the
   * placeholder to "Select {name}" and the old prefix test classified every
   * required dictionary as already-filled, left the row READY, and submitted empty
   * parameters — failing remotely as a marketplace rejection instead of here.
   */
  private async isComboboxEmpty(trigger: Locator): Promise<boolean> {
    if (
      (await trigger.locator('span.combobox__chips, span.combobox__custom-value').count()) > 0
    ) {
      return false;
    }

    const summary = trigger.locator('span.combobox__summary');
    const name = ((await trigger.getAttribute('aria-label')) ?? '').trim();
    if ((await summary.count()) === 0) {
      throw new Error(
        `Required Combobox parameter "${name || '(unlabelled)'}" renders none of the three ` +
          'known trigger bodies (chips / custom value / summary) — cannot tell whether it ' +
          'already has a value.',
      );
    }

    const label = (await summary.innerText()).trim();
    if (name && label.toLowerCase() === `pick ${name.toLowerCase()}`) return true;
    if (/^select[.…]{0,3}$/i.test(label)) return true;
    if (/^(pick|select|choose)\b/i.test(label)) {
      throw new Error(
        `Required Combobox parameter "${name || '(unlabelled)'}" shows "${label}", which reads ` +
          `like placeholder copy but is neither "Pick ${name.toLowerCase()}" nor "Select…" — ` +
          'the FE placeholder was probably renamed. Refusing to guess: treating it as filled ' +
          'would submit the offer with this required parameter empty.',
      );
    }
    return false;
  }
}
