/**
 * Products list page object
 *
 * Covers `/products` — the product DataTable, row multi-select, and the
 * `BulkActionBar` publish action. The action label depends on topology
 * (`products-list-page.tsx:1116-1118`): with exactly one publish destination it
 * reads `Publish to {platformDisplayName} (N)` and navigates STRAIGHT to the
 * bulk wizard (`:509-511`); with 2+ it reads `Publish products (N)` and opens
 * `OfferProductPickerModal` with the table's selection preseeded as whole
 * products (`:512-514` / `:1246`), so the operator only picks a destination
 * there. With 0 destinations the action is not rendered at all (`:1114`).
 *
 * @module pages
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { BulkOfferWizard } from './bulk-offer-wizard.page';
import { BULK_WIZARD_URL, OfferProductPickerModal } from './offer-product-picker.page';

export class ProductsListPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/products');
    await expect(this.page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  }

  /**
   * The page's own search box (`products-list-page.tsx:855`). Named in full so
   * it can never collide with the publish picker's `aria-label="Search products"`
   * (`offer-product-picker-modal.tsx:439`) once that modal is open.
   */
  get searchField(): Locator {
    return this.page.getByLabel('Search products by name or SKU', { exact: true });
  }

  /**
   * The row-select checkbox for a product identified by visible text (name or
   * SKU). Matched via a descendant EXACT-text locator (`products-list-page
   * .tsx:651-653`, the SKU's own `<span>`), not `hasText`'s substring match
   * against the row's whole flattened text: a SKU like `OL-ADIDAS-IA4845` is
   * itself a substring of a sibling product's `OL-ADIDAS-IA4845-S`, and this
   * stack routinely carries same-named products from different masters with
   * exactly that kind of SKU-prefix overlap. (A `\b`/lookaround regex against
   * the row's full text is the wrong tool here too — `-` is a non-word
   * character, so word-boundary tricks don't reliably land on the SKU's own
   * token boundary once other row content is concatenated in.)
   */
  selectRowCheckbox(productText: string): Locator {
    return this.page
      .getByRole('row')
      .filter({ has: this.page.getByText(productText, { exact: true }) })
      .getByRole('checkbox');
  }

  /**
   * Select a product by visible text, searching for it first.
   *
   * The table paginates at 20 rows (`products-list-page.tsx:68 PAGE_SIZE`)
   * while callers resolve their target through the API over a much wider scan
   * (`world.findMultiVariantProduct` walks 50) — so the chosen product is
   * routinely on page 2+ and simply absent from the DOM. Filtering first makes
   * the selection independent of where the product happens to sort.
   */
  async selectProduct(productText: string): Promise<void> {
    await this.searchField.fill(productText);
    const checkbox = this.selectRowCheckbox(productText);
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    await checkbox.check();
  }

  /**
   * The bulk action-bar publish button (`products-list-page.tsx:1115-1119`).
   *
   * Matches both topology labels — `Publish to {name} (N)` (one destination)
   * and `Publish products (N)` (2+). The count is `toLocaleString()`-formatted,
   * hence the separator-tolerant digit class.
   */
  get publishButton(): Locator {
    return this.page.getByRole('button', {
      name: /^Publish (?:products|to .+) \([\d\s,.\u00a0\u202f]+\)$/,
    });
  }

  /**
   * Click the publish action and land on the bulk wizard.
   *
   * With one publish destination the click navigates directly; with 2+ it opens
   * `OfferProductPickerModal` with the table selection already ticked, in which
   * case `connectionName` picks the destination in the modal's rail before
   * continuing.
   */
  async startBulkOfferCreation(connectionName?: string): Promise<BulkOfferWizard> {
    await this.publishButton.click();

    const picker = new OfferProductPickerModal(this.page);

    // Wait for whichever the topology produces: direct navigation or the picker.
    await expect(async () => {
      if (BULK_WIZARD_URL.test(this.page.url())) return;
      if (await picker.dialog.isVisible()) return;
      throw new Error('neither wizard navigation nor the publish picker appeared yet');
    }).toPass({ timeout: 15_000 });

    if (!BULK_WIZARD_URL.test(this.page.url())) {
      if (!connectionName) {
        throw new Error(
          'Publish picker opened (2+ publish destinations) but no connectionName was given',
        );
      }
      await picker.chooseDestination(connectionName);
      await picker.continueToWizard();
    }

    const wizard = new BulkOfferWizard(this.page);
    await wizard.expectOnConfigStep();
    return wizard;
  }
}
