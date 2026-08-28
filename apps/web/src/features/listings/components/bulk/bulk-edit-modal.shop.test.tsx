/**
 * BulkEditModal shop-mode tests (#1830)
 *
 * The shared two-pane editor rendered for a `ProductPublisher` (shop) destination:
 * the shop field set (title / description / price / stock / attributes /
 * visibility, category in the crumb bar), flat-vs-two-pane by variant shape, the
 * shop save payload (content / destinationCategoryIds / parameters on the base
 * override), per-variant description/price overrides, and the same-global-id
 * attribute de-duplication (`mergeShopParameter`).
 *
 * The shop category/attribute query hooks and the AI suggestion dialog are
 * stubbed so the test isolates the editor's own logic.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkEditModal, mergeShopParameter } from './bulk-edit-modal';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { OfferParameter } from '../../api/listings.types';
import type { BulkPerProductOverride } from '../../api/bulk-listings.types';
import type { Connection } from '../../../connections';
import type { Product, ProductVariant } from '../../../products';

vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
vi.mock('../../hooks/use-description-format-query', () => ({
  useDescriptionFormatQuery: () => ({
    // The frontend holds no format of its own since ADR-046, so a test that
    // needs an editor has to supply the destination's contract - a null format
    // deliberately renders a disabled placeholder instead.
    data: {
      shape: 'html',
      allowedTags: ['h1', 'h2', 'h3', 'p', 'b', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br'],
      allowedAttributes: { a: ['href'] },
      contentModel: null,
      rewrites: [],
      requiresBlockOpener: false,
      selfClosingVoids: false,
      maxBytes: null,
      declared: true,
      resolvedVia: 'ProductPublisher',
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/use-shop-attributes-query', () => ({
  useShopAttributesQuery: () => ({
    data: [{ id: 'pa_color', name: 'Color', slug: 'color' }],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../hooks/use-shop-attribute-terms-query', () => ({
  useShopAttributeTermsQuery: () => ({
    data: [
      { id: 't1', name: 'Red', slug: 'red' },
      { id: 't2', name: 'Blue', slug: 'blue' },
    ],
    isLoading: false,
    error: null,
  }),
}));

const shopConnection: Connection = {
  id: 'conn_shop',
  name: 'My Shop',
  platformType: 'woocommerce',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: ['ProductPublisher'],
  supportedCapabilities: ['ProductPublisher', 'ShopCategoryBrowser', 'ShopAttributeReader'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeVariant(id: string, attributes?: Record<string, string>): ProductVariant {
  return {
    id,
    productId: 'prod_1',
    sku: `SKU-${id}`,
    attributes: attributes ?? null,
    ean: null,
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStale: false,
    staleAt: null,
  };
}

function makeVariantRow(variant: ProductVariant): BulkVariantRow {
  return {
    variantId: variant.id,
    variant,
    ean: null,
    distinguishingAttributes: variant.attributes,
    masterStock: 5,
    masterPrice: 12,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: [],
    override: {},
  };
}

function makeRow(variants: ProductVariant[]): BulkWizardRow {
  const product: Product = {
    id: 'prod_1',
    name: 'Widget',
    sku: 'SKU',
    price: 12,
    currency: 'PLN',
    description: 'Master description',
    images: [],
    variants,
  } as unknown as Product;
  return {
    productId: 'prod_1',
    product,
    primaryVariant: variants[0],
    variants: variants.map(makeVariantRow),
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 12,
    masterStock: 5,
    masterCurrency: 'PLN',
    categoryCandidates: [],
    override: {},
  };
}

function renderShopEditor(
  row: BulkWizardRow,
  onSave: (
    productId: string,
    baseOverride: BulkPerProductOverride,
    perVariantOverrides: Record<string, BulkPerProductOverride>,
    included: Record<string, boolean>,
    editFormValues: Record<string, unknown>,
  ) => void,
  extra: Partial<{ demoReadOnly: boolean }> = {},
): void {
  renderWithProviders(
    <BulkEditModal
      open
      onOpenChange={() => undefined}
      row={row}
      connection={shopConnection}
      {...extra}
      destinationKind="shop"
      canBrowseCategories={false}
      canBrowseShopCategories
      canPickShopAttributes
      currency="PLN"
      defaults={{ publishImmediately: true }}
      onSave={onSave}
    />,
  );
}

/**
 * Selects a variant's rail entry and returns its panel container. The base
 * scope form stays mounted (just `hidden`) while a variant is active, so any
 * unscoped query (e.g. the "Attribute" picker's select, present in both
 * forms) would otherwise match twice - scoping to the panel's own subtree
 * keeps every assertion unambiguous.
 */
function openVariantPanel(label: RegExp | string): HTMLElement {
  fireEvent.click(screen.getByRole('radio', { name: label }));
  const heading = screen.getByRole('heading', { name: /^Variant ·/ });
  const panel = heading.closest('.bulk-editor__form');
  if (!panel) throw new Error('variant panel container not found');
  return panel as HTMLElement;
}

describe('mergeShopParameter', () => {
  it('appends a distinct-id parameter', () => {
    const existing: OfferParameter[] = [{ id: 'pa_color', values: ['Red'], section: 'product' }];
    const next = mergeShopParameter(existing, { id: 'pa_size', values: ['M'], section: 'product' });
    expect(next).toHaveLength(2);
  });

  it('unions term values + ids when the same global-attribute id repeats', () => {
    const existing: OfferParameter[] = [
      { id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' },
    ];
    const merged = mergeShopParameter(existing, {
      id: 'pa_color',
      values: ['Blue'],
      valuesIds: ['t2'],
      section: 'product',
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      id: 'pa_color',
      values: ['Red', 'Blue'],
      valuesIds: ['t1', 't2'],
      section: 'product',
    });
  });

  it('does not duplicate an already-present term id', () => {
    const existing: OfferParameter[] = [
      { id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' },
    ];
    const merged = mergeShopParameter(existing, {
      id: 'pa_color',
      values: ['Red'],
      valuesIds: ['t1'],
      section: 'product',
    });
    expect(merged[0].valuesIds).toEqual(['t1']);
  });

  it('unions custom (no-id) attribute values', () => {
    const existing: OfferParameter[] = [{ id: 'Material', values: ['Cotton'], section: 'product' }];
    const merged = mergeShopParameter(existing, {
      id: 'Material',
      values: ['Wool'],
      section: 'product',
    });
    expect(merged[0].values).toEqual(['Cotton', 'Wool']);
  });
});

describe('BulkEditModal (shop mode)', () => {
  it('renders a flat shop editor (no rail) for a simple product with shop-only sections', () => {
    renderShopEditor(makeRow([makeVariant('v1')]), vi.fn());

    expect(screen.getByRole('heading', { name: 'Product fields' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Stock')).toBeInTheDocument();
    // Category lives in the crumb bar, not a mid-form field.
    expect(screen.getByRole('button', { name: 'Change category' })).toBeInTheDocument();
    // No variant rail for a simple product, and no marketplace EAN self-link.
    expect(screen.queryByRole('radiogroup', { name: 'Variant scope selector' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('EAN (GTIN)')).not.toBeInTheDocument();
  });

  it('renders the two-pane rail for a multi-variant product', () => {
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, vi.fn());
    expect(screen.getByRole('radiogroup', { name: 'Variant scope selector' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Shared base/ })).toBeInTheDocument();
  });

  it('saves shop content + price + stock on the base override for a simple product', () => {
    const onSave = vi.fn();
    renderShopEditor(makeRow([makeVariant('v1')]), onSave);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
    fireEvent.change(screen.getByLabelText('Price'), { target: { value: '49.90' } });
    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [productId, baseOverride] = onSave.mock.calls[0];
    expect(productId).toBe('prod_1');
    expect(baseOverride.overrides.title).toBe('New title');
    expect(baseOverride.price).toEqual({ amount: 49.9, currency: 'PLN' });
    expect(baseOverride.stock).toBe(8);
  });

  it('de-duplicates two adds of the same global attribute id into one parameter (#1830)', () => {
    const onSave = vi.fn();
    renderShopEditor(makeRow([makeVariant('v1')]), onSave);

    // Pick the global attribute, then add Red and Blue as two separate adds.
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'pa_color' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, baseOverride] = onSave.mock.calls[0];
    expect(baseOverride.overrides.parameters).toEqual([
      { id: 'pa_color', values: ['Red', 'Blue'], valuesIds: ['t1', 't2'], section: 'product' },
    ]);
  });

/**
 * Type a description into a rich-text field through the editor's HTML view.
 *
 * A `fireEvent.change` on the editing surface is impossible - it is a
 * contenteditable, so it has no value setter - and `userEvent.type` inserts
 * nothing into ProseMirror in any test DOM (see #2201). The HTML view is a real
 * `<textarea>` and a real operator path: click HTML, edit, click Rich text, which
 * round-trips the markup through the destination's schema and emits onChange.
 */
function setDescriptionViaHtmlView(scope: HTMLElement, html: string): void {
  fireEvent.click(within(scope).getByRole('button', { name: 'HTML' }));
  fireEvent.change(within(scope).getByRole('textbox', { name: /HTML source/ }), {
    target: { value: html },
  });
  fireEvent.click(within(scope).getByRole('button', { name: 'Rich text' }));
}

  it('makes the description non-editable for a demo read-only viewer (#2200)', () => {
    // The regression this pins: demo read-only is enforced by a wrapping
    // `<fieldset disabled>`, and that cascade reaches FORM CONTROLS only. A
    // contenteditable is not one, so when the description became rich text it
    // silently went live for a public demo viewer while Save stayed locked -
    // exactly the editable-but-uncommittable middle state the demo policy
    // (#1615) exists to avoid. Each editor now takes an explicit `disabled`.
    renderShopEditor(makeRow([makeVariant('v1')]), vi.fn(), { demoReadOnly: true });

    const surfaces = screen.getAllByRole('textbox', { name: /description/i });
    expect(surfaces.length).toBeGreaterThan(0);
    for (const surface of surfaces) {
      expect(surface).toHaveAttribute('contenteditable', 'false');
    }
  });

  it('leaves the description editable for a normal operator', () => {
    renderShopEditor(makeRow([makeVariant('v1')]), vi.fn());

    expect(screen.getAllByRole('textbox', { name: /description/i })[0]).toHaveAttribute(
      'contenteditable',
      'true',
    );
  });

  it('emits a per-variant description override in the two-pane editor (#1830)', () => {
    const onSave = vi.fn();
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, onSave);

    // Focus the first variant scope, override its description.
    fireEvent.click(screen.getByRole('radio', { name: /Size: M|M$/ }));
    const editors = screen.getAllByLabelText(/Description for/);
    const scope = editors[0].closest('.rich-text') as HTMLElement;
    setDescriptionViaHtmlView(scope, 'Only for M');
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, , perVariantOverrides] = onSave.mock.calls[0] as [
      string,
      BulkPerProductOverride,
      Record<string, BulkPerProductOverride>,
    ];
    // Wrapped in a paragraph on the way through the schema: the shop format
    // requires a block opener, so this is the value that would really publish.
    expect(perVariantOverrides.v1.overrides?.description).toBe('<p>Only for M</p>');
  });

  it('renders provenance badges + reset affordances in the variant panel, matching the marketplace panel (#1838)', () => {
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, vi.fn());

    const panel = openVariantPanel(/Size: M|M$/);

    // Description, Attributes, and Price all start inherited - muted styling,
    // no reset control yet (three "inherited" badges: description/attributes/price).
    const description = within(panel).getByLabelText(/Description for/);
    expect(description.closest('.rich-text')).toHaveClass('bulk-editor__input--inherited');
    expect(within(panel).queryByText(/reset to base/)).not.toBeInTheDocument();
    expect(within(panel).getAllByText('inherited').length).toBeGreaterThanOrEqual(3);

    // Stock is always master-provenance, never overridable (parity with the
    // marketplace variant panel's read-only master stock field).
    const stock = within(panel).getByDisplayValue('5');
    expect(stock).toHaveAttribute('readonly');
    expect(within(panel).getByText('from master')).toBeInTheDocument();

    // Overriding description flips the badge + input styling and surfaces reset.
    setDescriptionViaHtmlView(description.closest('.rich-text') as HTMLElement, 'Only for M');
    expect(description.closest('.rich-text')).toHaveClass('bulk-editor__input--overridden');
    const resetButton = within(panel).getByText(/reset to base/);
    expect(resetButton).toBeInTheDocument();

    fireEvent.click(resetButton);
    expect(description.closest('.rich-text')).toHaveClass('bulk-editor__input--inherited');
    expect(within(panel).queryByText(/reset to base/)).not.toBeInTheDocument();
  });

  it('emits a per-variant attribute override on top of the base list (#1838)', () => {
    const onSave = vi.fn();
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, onSave);

    // Add a base-level attribute first (single picker instance while on the
    // shared-base scope), then switch to the variant to add its own.
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'pa_color' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Red' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    const panel = openVariantPanel(/Size: M|M$/);
    // Inherited effective list surfaces the base pick even before overriding.
    expect(within(panel).getByText('pa_color: Red')).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText('Attribute'), { target: { value: 'pa_color' } });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Blue' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add attribute' }));

    expect(within(panel).getByText('overridden')).toBeInTheDocument();
    expect(within(panel).getByText(/reset to base/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, baseOverride, perVariantOverrides] = onSave.mock.calls[0] as [
      string,
      BulkPerProductOverride,
      Record<string, BulkPerProductOverride>,
    ];
    expect(baseOverride.overrides?.parameters).toEqual([
      { id: 'pa_color', values: ['Red'], valuesIds: ['t1'], section: 'product' },
    ]);
    expect(perVariantOverrides.v1.overrides?.parameters).toEqual([
      { id: 'pa_color', values: ['Red', 'Blue'], valuesIds: ['t1', 't2'], section: 'product' },
    ]);
    // The other variant never diverged - no override recorded for it.
    expect(perVariantOverrides.v2).toBeUndefined();
  });

  it('reverts a per-variant attribute override to inherited via the reset control (#1838)', () => {
    const onSave = vi.fn();
    const row = makeRow([makeVariant('v1', { Size: 'M' }), makeVariant('v2', { Size: 'L' })]);
    renderShopEditor(row, onSave);

    const panel = openVariantPanel(/Size: M|M$/);
    fireEvent.change(within(panel).getByLabelText('Attribute'), { target: { value: 'pa_color' } });
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Red' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add attribute' }));
    expect(within(panel).getByText('overridden')).toBeInTheDocument();

    fireEvent.click(within(panel).getByText(/reset to base/));
    expect(within(panel).queryByText('overridden')).not.toBeInTheDocument();
    expect(within(panel).queryByText('pa_color: Red')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    const [, , perVariantOverrides] = onSave.mock.calls[0] as [
      string,
      BulkPerProductOverride,
      Record<string, BulkPerProductOverride>,
    ];
    expect(perVariantOverrides.v1).toBeUndefined();
  });
});
