/**
 * BulkShopReviewStep pure-helper tests (#1829)
 *
 * Pins `buildBulkShopPublishItems`: one `bulk-shop-publish` item per INCLUDED
 * variant, stock resolved from master availability + the batch stock policy,
 * price from the variant master price + the batch pricing policy, excluded
 * variants dropped, and a null resolved price omitted (shop builder falls back
 * to master server-side).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';

// Isolate the shop editor render from the AI suggestion dialog (#1830).
vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
import {
  BulkShopReviewStep,
  buildBulkShopPublishItems,
  type ShopPublishVisibility,
} from './bulk-shop-review-step';
import type { BulkVariantRow, BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';
import type { BulkShopPublishItemRequest } from '../../api/listings.types';
import type { Connection } from '../../../connections';
import type { Product, ProductVariant } from '../../../products';

function makeVariantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = { id, productId: 'prod_1', sku: id } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: null,
    distinguishingAttributes: null,
    masterStock: null,
    masterPrice: 39,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function makeRow(productId: string, variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId,
    product: { id: productId, name: 'P', currency: 'PLN' } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    override: {},
  };
}

function config(over: Partial<BulkWizardConfig> = {}): BulkWizardConfig {
  return {
    connectionId: 'conn_shop',
    platformParams: {},
    currency: 'PLN',
    pricingPolicy: { mode: 'use-master' },
    stockPolicy: { mode: 'use-master' },
    publishImmediately: true,
    generateDescription: false,
    ...over,
  };
}

describe('buildBulkShopPublishItems', () => {
  it('emits one item per included variant with master-derived price + availability stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2')])];
    const items = buildBulkShopPublishItems(
      rows,
      config(),
      new Map([
        ['v1', 7],
        ['v2', 3],
      ]),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 7, price: { amount: 39, currency: 'PLN' } },
      { internalVariantId: 'v2', stock: 3, price: { amount: 39, currency: 'PLN' } },
    ]);
  });

  it('drops excluded variants', () => {
    const rows = [
      makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })]),
    ];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 5]]));
    expect(items.map((i) => i.internalVariantId)).toEqual(['v1']);
  });

  it('applies flat stock + flat price policies', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(
      rows,
      config({ stockPolicy: { mode: 'flat', value: 10 }, pricingPolicy: { mode: 'flat', amount: 99 } }),
      new Map(),
    );
    expect(items).toEqual([
      { internalVariantId: 'v1', stock: 10, price: { amount: 99, currency: 'PLN' } },
    ]);
  });

  it('omits price when master price is missing under use-master pricing', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1', { masterPrice: null })])];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 4]]));
    expect(items).toEqual([{ internalVariantId: 'v1', stock: 4 }]);
    expect(items[0]).not.toHaveProperty('price');
  });

  it('sends 0 stock when no availability is known under use-master stock', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(rows, config(), new Map());
    expect(items[0].stock).toBe(0);
  });

  it('threads per-product content, destination categories, and parameters onto each item (#1830)', () => {
    const row = makeRow('prod_1', [makeVariantRow('v1')]);
    row.override = {
      overrides: {
        title: 'Custom title',
        description: 'Base description',
        imageUrls: ['https://img/1.jpg'],
        destinationCategoryIds: ['cat_42'],
        parameters: [{ id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' }],
      },
    };
    const items = buildBulkShopPublishItems([row], config(), new Map([['v1', 5]]));
    expect(items[0]).toMatchObject({
      internalVariantId: 'v1',
      content: {
        title: 'Custom title',
        description: 'Base description',
        imageUrls: ['https://img/1.jpg'],
      },
      destinationCategoryIds: ['cat_42'],
      parameters: [{ id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' }],
    });
  });

  it('lets a per-variant description override win over the base content (#1830)', () => {
    const v1 = makeVariantRow('v1', {
      override: { overrides: { description: 'Variant-specific copy' } },
    });
    const row = makeRow('prod_1', [v1]);
    row.override = { overrides: { description: 'Base description' } };
    const items = buildBulkShopPublishItems([row], config(), new Map([['v1', 5]]));
    expect(items[0].content?.description).toBe('Variant-specific copy');
  });

  it('preserves a defined-but-empty destinationCategoryIds (uncategorised) (#1830)', () => {
    const row = makeRow('prod_1', [makeVariantRow('v1')]);
    row.override = { overrides: { destinationCategoryIds: [] } };
    const items = buildBulkShopPublishItems([row], config(), new Map([['v1', 5]]));
    expect(items[0].destinationCategoryIds).toEqual([]);
  });

  it('omits content/category/parameters for a passthrough item with no overrides (#1830)', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const items = buildBulkShopPublishItems(rows, config(), new Map([['v1', 5]]));
    expect(items[0]).not.toHaveProperty('content');
    expect(items[0]).not.toHaveProperty('destinationCategoryIds');
    expect(items[0]).not.toHaveProperty('parameters');
  });
});

const shopConnection = {
  id: 'conn_shop',
  name: 'My Shop',
  status: 'active',
  platformType: 'woocommerce',
  supportedCapabilities: ['ProductPublisher'],
  enabledCapabilities: ['ProductPublisher'],
} as unknown as Connection;

function renderStep(
  rows: BulkWizardRow[],
  cfg: BulkWizardConfig,
  handlers: {
    onPublish?: (items: BulkShopPublishItemRequest[], status: ShopPublishVisibility) => void;
    onSetVariantIncluded?: (p: string, v: string, i: boolean) => void;
    onBack?: () => void;
    onSaveEditor?: () => void;
  } = {},
  availability: { productVariantId: string; totalAvailable: number }[] = [],
): void {
  const apiClient = createMockApiClient({
    inventory: {
      availability: vi.fn().mockResolvedValue({ items: availability }),
    },
  });
  renderWithProviders(
    <BulkShopReviewStep
      rows={rows}
      connection={shopConnection}
      config={cfg}
      demoReadOnly={false}
      isSubmitting={false}
      errorMessage={null}
      alreadyListedVariantIds={new Set<string>()}
      destinationName="Test Shop"
      onSetVariantIncluded={handlers.onSetVariantIncluded ?? ((): void => undefined)}
      onBack={handlers.onBack ?? ((): void => undefined)}
      onPublish={handlers.onPublish ?? ((): void => undefined)}
      onSaveEditor={handlers.onSaveEditor ?? ((): void => undefined)}
    />,
    { apiClient },
  );
}

describe('BulkShopReviewStep (render)', () => {
  it('shows the resolved description on a single-variant product row', async () => {
    // Same gap as the marketplace step: a simple product publishes from the
    // PRODUCT row - no variant row is rendered - so a disclosure that lives only
    // on the variant row never appears for the most common case (#2200). The
    // assertion is on the resolved TEXT so that showing the wrong line's copy,
    // or nothing, fails here.
    const variant = makeVariantRow('v1', {
      override: { overrides: { description: '<p>Opis sklepowy</p>' } },
    } as Partial<BulkVariantRow>);
    renderStep([makeRow('prod_1', [variant])], config(), {}, [
      { productVariantId: 'v1', totalAvailable: 3 },
    ]);

    await screen.findAllByText('Description');
    const disclosure = document.querySelector('.bulk-review__prow-main .bulk-review__desc');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.textContent).toContain('Opis sklepowy');
  });

  it('keeps the disclosure off the product row of a multi-variant product', async () => {
    // Non-duplication: for a multi-variant product each variant row carries its
    // own disclosure, so the product row must not add a second one.
    renderStep(
      [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2')])],
      config(),
      {},
      [{ productVariantId: 'v1', totalAvailable: 3 }],
    );

    // Deliberately NOT waiting on the word "Description": for a multi-variant
    // product it must not appear at all until a row is expanded, so waiting for
    // it would be waiting for the very thing under test to be wrong.
    await waitFor(() => {
      expect(document.querySelector('.bulk-review__prow-main')).not.toBeNull();
    });
    expect(document.querySelectorAll('.bulk-review__prow-main .bulk-review__desc')).toHaveLength(0);
  });

  it('renders one row per variant (included and excluded) and displays the resolved stock + price it will submit', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })])];
    // use-master stock (availability 7) + flat price 99 -> review must show both.
    renderStep(
      rows,
      config({ pricingPolicy: { mode: 'flat', amount: 99 } }),
      {},
      [{ productVariantId: 'v1', totalAvailable: 7 }],
    );

    // Multi-variant product - expand the group to reveal per-variant rows.
    fireEvent.click(await screen.findByRole('button', { name: /Expand P variants/ }));

    // Both the included and the excluded variant render a row, distinguished
    // by their include checkbox's checked state.
    expect(await screen.findByLabelText('Include P - v1')).toBeChecked();
    expect(screen.getByLabelText('Include P - v2')).not.toBeChecked();

    // Displayed stock == resolved availability; price == flat policy value
    // (computed for both lines - flat pricing does not depend on inclusion).
    // 3 occurrences: the product row's own aggregate price cell (mirrors the
    // marketplace product row showing its first variant's price) plus the
    // two expanded per-variant sub-rows.
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
    expect(screen.getAllByText('99 PLN').length).toBe(3);
  });

  it('publishes the resolved items with the chosen visibility', async () => {
    const onPublish = vi.fn();
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(
      rows,
      config({ pricingPolicy: { mode: 'flat', amount: 99 } }),
      { onPublish },
      [{ productVariantId: 'v1', totalAvailable: 7 }],
    );

    // Flip visibility to Draft, then publish.
    fireEvent.click(await screen.findByRole('button', { name: 'Draft' }));
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
    // Rendered twice (header top CTA + footer CTA); click the first.
    fireEvent.click(screen.getAllByRole('button', { name: /Publish 1 listing/ })[0]);

    expect(onPublish).toHaveBeenCalledWith(
      [{ internalVariantId: 'v1', stock: 7, price: { amount: 99, currency: 'PLN' } }],
      'draft',
    );
  });

  it('excludes a variant via its include checkbox', async () => {
    const onSetVariantIncluded = vi.fn();
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(rows, config(), { onSetVariantIncluded });

    fireEvent.click(await screen.findByLabelText('Include P - v1'));
    expect(onSetVariantIncluded).toHaveBeenCalledWith('prod_1', 'v1', false);
  });

  it('warns and soft-blocks publish when a resolved line is out of stock (#1842)', async () => {
    const onPublish = vi.fn();
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(
      rows,
      config({ pricingPolicy: { mode: 'flat', amount: 99 } }),
      { onPublish },
      [{ productVariantId: 'v1', totalAvailable: 0 }],
    );

    expect((await screen.findAllByText(/out of stock|needs attention/i)).length).toBeGreaterThan(0);
    const publishButtons = screen.getAllByRole('button', { name: /Publish 1 listing/ });
    publishButtons.forEach((btn) => expect(btn).toBeDisabled());

    fireEvent.click(publishButtons[0]);
    expect(onPublish).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', { name: /Publish anyway - I understand/i }),
    );
    screen
      .getAllByRole('button', { name: /Publish 1 listing/ })
      .forEach((btn) => expect(btn).toBeEnabled());

    fireEvent.click(screen.getAllByRole('button', { name: /Publish 1 listing/ })[0]);
    expect(onPublish).toHaveBeenCalledWith(
      [{ internalVariantId: 'v1', stock: 0, price: { amount: 99, currency: 'PLN' } }],
      'published',
    );
  });

  it('does not show the out-of-stock banner when every line has stock', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(rows, config(), {}, [{ productVariantId: 'v1', totalAvailable: 3 }]);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
    expect(screen.queryByText(/out of stock/i)).not.toBeInTheDocument();
  });

  it('shows the empty-state alert when no variants are included', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1', { included: false })])];
    renderStep(rows, config());
    expect(screen.getAllByText(/No variants are included/i).length).toBeGreaterThan(0);
  });

  it('shows a ready pill for an included in-stock line and an excluded pill for an excluded line', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2', { included: false })])];
    renderStep(rows, config(), {}, [{ productVariantId: 'v1', totalAvailable: 5 }]);

    // Multi-variant product - expand the group to reveal per-variant rows.
    fireEvent.click(await screen.findByRole('button', { name: /Expand P variants/ }));

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(
      document.querySelector('.bulk-shop-review__vrows .bulk-chip--success'),
    ).toHaveTextContent('ready');
    expect(
      document.querySelector('.bulk-shop-review__vrows .bulk-chip--neutral'),
    ).toHaveTextContent('excluded');
  });

  it('shows the ready/needs-attention/excluded summary bar', async () => {
    const rows = [
      makeRow('prod_1', [
        makeVariantRow('v1', { masterPrice: 39 }),
        makeVariantRow('v2', { included: false, masterPrice: 39 }),
      ]),
    ];
    renderStep(rows, config(), {}, [{ productVariantId: 'v1', totalAvailable: 0 }]);

    await waitFor(() => {
      expect(document.querySelector('.bulk-review__summary')).toBeInTheDocument();
    });
    expect(screen.getByText('need attention')).toBeInTheDocument();
    expect(screen.getByText('excluded')).toBeInTheDocument();
  });

  it('opens the shop editor from a row Edit button (#1830)', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    renderStep(rows, config(), {}, [{ productVariantId: 'v1', totalAvailable: 7 }]);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit P' }));
    // The shop editor mounts its title field (a shop-only "Product fields" scope).
    expect(await screen.findByRole('heading', { name: 'Product fields' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });
});

describe('BulkShopReviewStep already-listed chip (#1838)', () => {
  it('renders the "already on {destination}" chip with an aria-hidden decorative dot', async () => {
    const rows = [makeRow('prod_1', [makeVariantRow('v1')])];
    const apiClient = createMockApiClient({
      inventory: { availability: vi.fn().mockResolvedValue({ items: [{ productVariantId: 'v1', totalAvailable: 7 }] }) },
    });
    renderWithProviders(
      <BulkShopReviewStep
        rows={rows}
        connection={shopConnection}
        config={config()}
        demoReadOnly={false}
        isSubmitting={false}
        errorMessage={null}
        alreadyListedVariantIds={new Set(['v1'])}
        destinationName="Test Shop"
        onSetVariantIncluded={(): void => undefined}
        onBack={(): void => undefined}
        onPublish={(): void => undefined}
        onSaveEditor={(): void => undefined}
      />,
      { apiClient },
    );

    const chip = await screen.findByText(/already on Test Shop/);
    const dot = chip.parentElement?.querySelector('.bulk-chip__dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('BulkShopReviewStep grouping/filter/expand (#1838 whole-epic review)', () => {
  function multiVariantRows(): BulkWizardRow[] {
    return [makeRow('prod_1', [makeVariantRow('v1'), makeVariantRow('v2')])];
  }

  it('groups a multi-variant product behind a collapsed expand toggle', async () => {
    renderStep(multiVariantRows(), config(), {}, [
      { productVariantId: 'v1', totalAvailable: 7 },
      { productVariantId: 'v2', totalAvailable: 3 },
    ]);

    await screen.findByText('2 variants');
    // Collapsed by default - no per-variant include checkboxes rendered yet.
    expect(screen.queryByLabelText(/Include P - /)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Expand P variants/ }),
    ).toBeInTheDocument();
  });

  it('expands a group to reveal its per-variant rows', async () => {
    renderStep(multiVariantRows(), config(), {}, [
      { productVariantId: 'v1', totalAvailable: 7 },
      { productVariantId: 'v2', totalAvailable: 3 },
    ]);

    const toggle = await screen.findByRole('button', { name: /Expand P variants/ });
    fireEvent.click(toggle);

    expect(await screen.findByLabelText('Include P - v1')).toBeInTheDocument();
    expect(screen.getByLabelText('Include P - v2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Collapse P variants/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Collapse P variants/ }));
    expect(screen.queryByLabelText('Include P - v1')).not.toBeInTheDocument();
  });

  it('narrows the visible set via the filter box', async () => {
    const rows = [
      makeRow('prod_1', [makeVariantRow('v1')]),
      { ...makeRow('prod_2', [makeVariantRow('v2')]), product: { id: 'prod_2', name: 'Other', currency: 'PLN' } as never },
    ];
    renderStep(rows, config(), {}, [
      { productVariantId: 'v1', totalAvailable: 7 },
      { productVariantId: 'v2', totalAvailable: 5 },
    ]);

    // "P" is a single-letter product name here, so it also matches the
    // thumbnail fallback initial (`<span aria-hidden>P</span>`) - scope to
    // the product-name `<b>` tag to disambiguate.
    expect(await screen.findByText('P', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter products by name or SKU'), {
      target: { value: 'Other' },
    });

    expect(screen.queryByText('P', { selector: 'b' })).not.toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows only flagged rows (out of stock) when "Only flagged" is checked', async () => {
    const rows = [
      makeRow('prod_1', [makeVariantRow('v1')]),
      { ...makeRow('prod_2', [makeVariantRow('v2')]), product: { id: 'prod_2', name: 'Other', currency: 'PLN' } as never },
    ];
    renderStep(rows, config(), {}, [
      { productVariantId: 'v1', totalAvailable: 0 },
      { productVariantId: 'v2', totalAvailable: 5 },
    ]);

    // "P" is a single-letter product name here, so it also matches the
    // thumbnail fallback initial (`<span aria-hidden>P</span>`) - scope to
    // the product-name `<b>` tag to disambiguate.
    expect(await screen.findByText('P', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Only flagged' }));

    expect(screen.getByText('P', { selector: 'b' })).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });
});
