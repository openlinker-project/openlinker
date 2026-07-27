/**
 * BulkEditModal tests (#1741)
 *
 * The per-variant two-pane editor: base-scope fields (title snapshot, multi-match
 * candidate chips, category picker vs manual id, category-parameter step, Erli
 * delivery-price-list override) for a single-variant/simple product, plus the
 * multi-variant rail + per-variant EAN override path.
 *
 * The category picker, parameters query, parameters step, and AI suggestion
 * dialog are stubbed so the test isolates the modal's own logic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkEditModal } from './bulk-edit-modal';
import type * as CategoryParametersStepModule from '../category-parameters-step';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { EanMatchCandidate } from '../../api/listings.types';
import type { Product, ProductVariant } from '../../../products';
import type { Connection } from '../../../connections';

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: ({ value }: { value: string | null }) => (
    <div data-testid="category-picker">{value ?? 'none'}</div>
  ),
}));
// Mutable so a test can drive the category-parameters query result (#1367).
let mockCategoryParameters: unknown[] = [];
vi.mock('../../hooks/use-category-parameters-query', () => ({
  useCategoryParametersQuery: () => ({
    data: mockCategoryParameters,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../content', () => ({ SuggestionDialog: () => null }));
// Stub only the heavy base-scope step; keep the real value<->combobox helpers
// the per-variant dictionary override reuses.
vi.mock('../category-parameters-step', async (importOriginal) => {
  const actual = await importOriginal<typeof CategoryParametersStepModule>();
  return {
    ...actual,
    // Echo the parameter names it receives so a test can assert which params the
    // bulk base scope passes through (the EAN/GTIN slot is filtered out, #1741).
    CategoryParametersStep: ({ parameters }: { parameters: Array<{ name: string }> }) => (
      <div data-testid="category-parameters-step">{parameters.map((p) => p.name).join(',')}</div>
    ),
  };
});

const DEFAULTS = { publishImmediately: true };

const connection: Connection = {
  id: 'conn_1',
  name: 'My Allegro',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// Erli connection - advertises DeliveryPriceListReader so the modal renders the
// per-row delivery-price-list override field (#1530).
const erliConnection: Connection = {
  ...connection,
  id: 'conn_erli',
  name: 'My Erli',
  platformType: 'erli',
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager', 'DeliveryPriceListReader'],
};

function erliApiClient() {
  return createMockApiClient({
    listings: {
      getDeliveryPriceLists: vi.fn().mockResolvedValue({
        deliveryPriceLists: [
          { id: '1', name: '*' },
          { id: '2', name: 'Kurier' },
        ],
      }),
    },
  });
}

function makeVariant(id: string, opts: { ean?: string | null; attributes?: Record<string, string> | null } = {}): ProductVariant {
  return {
    id,
    productId: 'prod_1',
    sku: `SKU-${id}`,
    attributes: opts.attributes ?? null,
    ean: opts.ean ?? null,
    gtin: null,
    price: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeVariantRow(variant: ProductVariant, opts: { candidates?: EanMatchCandidate[]; attributes?: Record<string, string> | null } = {}): BulkVariantRow {
  return {
    variantId: variant.id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: opts.attributes ?? null,
    masterStock: 5,
    masterPrice: 12,
    masterCurrency: 'PLN',
    included: true,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    categoryCandidates: opts.candidates ?? [],
    override: {},
  };
}

// A single-variant (simple) product - flat editor, no rail.
function makeRow(opts: { name?: string; candidates?: EanMatchCandidate[] } = {}): BulkWizardRow {
  const variant = makeVariant('var_1', { ean: '590' });
  const product: Product = {
    id: 'prod_1',
    name: opts.name ?? 'Widget',
    sku: 'SKU',
    price: 12,
    currency: 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    productId: 'prod_1',
    product,
    primaryVariant: variant,
    variants: [makeVariantRow(variant, { candidates: opts.candidates })],
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 12,
    masterStock: 5,
    masterCurrency: 'PLN',
    categoryCandidates: opts.candidates ?? [],
    override: {},
  };
}

// A multi-variant product - two siblings with distinguishing attributes.
function makeMultiRow(): BulkWizardRow {
  const vS = makeVariant('var_s', { ean: '5901520000059', attributes: { Rozmiar: 'S' } });
  const vM = makeVariant('var_m', { ean: '5900531001130', attributes: { Rozmiar: 'M' } });
  const product: Product = {
    id: 'prod_2',
    name: 'Hoodie',
    sku: 'HOODIE',
    price: 129,
    currency: 'PLN',
    description: 'A hoodie',
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    productId: 'prod_2',
    product,
    primaryVariant: vS,
    variants: [
      makeVariantRow(vS, { attributes: { Rozmiar: 'S' } }),
      makeVariantRow(vM, { attributes: { Rozmiar: 'M' } }),
    ],
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 129,
    masterStock: 10,
    masterCurrency: 'PLN',
    categoryCandidates: [],
    override: {},
  };
}

describe('BulkEditModal', () => {
  beforeEach(() => {
    mockCategoryParameters = [];
  });

  it('renders a suggested-category chip per multi-match candidate, falling back to the id', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({
          candidates: [
            { allegroCategoryId: 'cat-B', productCardId: 'card-B', name: 'Books' },
            { allegroCategoryId: 'cat-C', productCardId: 'card-C' },
          ],
        })}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Books' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cat-C' })).toBeInTheDocument();
  });

  it('does not render the suggestion chip row when there are no candidates', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );
    expect(screen.queryByText(/Suggested categories/)).not.toBeInTheDocument();
  });

  it('pre-fills the title from a snapshot and does not re-bind when the row prop changes mid-edit', () => {
    const { rerender } = renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({ name: 'Widget' })}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();

    rerender(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({ name: 'Changed name' })}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Changed name')).not.toBeInTheDocument();
  });

  it('threads the picked candidate product card into the saved base override (#810)', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow({
          candidates: [{ allegroCategoryId: 'cat-B', productCardId: 'card-B', name: 'Books' }],
        })}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Books' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const baseOverride = onSave.mock.calls[0][1] as {
      overrides?: { categoryId?: string; productCardId?: string };
    };
    expect(baseOverride.overrides?.categoryId).toBe('cat-B');
    expect(baseOverride.overrides?.productCardId).toBe('card-B');
  });

  it('renders a manual category-id input instead of the tree picker when the destination cannot browse', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByLabelText('Allegro category ID')).toBeInTheDocument();
    expect(screen.queryByTestId('category-picker')).not.toBeInTheDocument();
  });

  it('omits a blank category from the saved base override so the backend resolves it at submit (#1096)', async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const baseOverride = onSave.mock.calls[0][1] as { overrides?: { categoryId?: string } };
    expect(baseOverride.overrides?.categoryId).toBeUndefined();
  });

  it('opens the zoom lightbox when an editor image thumbnail is clicked (#1741)', () => {
    const row = makeRow();
    row.product!.images = ['https://example.com/a.jpg'];
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={row}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close image' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom image' }));
    expect(screen.getByRole('button', { name: 'Close image' })).toBeInTheDocument();
  });

  it('prefills the offer-EAN field from the master barcode on a simple product (#1741)', () => {
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );
    // makeRow's variant carries master EAN '590'.
    expect(screen.getByLabelText('EAN (GTIN)')).toHaveValue('590');
  });

  it('writes a supplied offer EAN into the base override for a barcode-less simple product (#1741)', async () => {
    const onSave = vi.fn();
    const row = makeRow();
    row.variants[0].variant.ean = null;
    row.variants[0].variant.gtin = null;
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={row}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={onSave}
      />,
    );

    const eanField = screen.getByLabelText('EAN (GTIN)');
    expect(eanField).toHaveValue('');
    fireEvent.change(eanField, { target: { value: '5901234123457' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const baseOverride = onSave.mock.calls[0][1] as { overrides?: { ean?: string } };
    expect(baseOverride.overrides?.ean).toBe('5901234123457');
  });

  it('opens the Choose-category modal from the chip and Select sets the category (#1741)', async () => {
    const onSave = vi.fn();
    const apiClient = createMockApiClient({
      mappings: {
        getAllegroCategories: vi.fn().mockResolvedValue([
          { id: 'cat-9', name: 'Ladowarki', parentId: null, leaf: true },
        ]),
      },
    });
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={makeRow()}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={onSave}
      />,
      { apiClient },
    );

    // The chip's change button opens the external picker (no inline picker now).
    expect(screen.queryByTestId('category-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /change/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
    const baseOverride = onSave.mock.calls[0][1] as { overrides?: { categoryId?: string } };
    expect(baseOverride.overrides?.categoryId).toBe('cat-9');
  });

  it('renders the category-parameter step for a browsable destination once a category is resolved (#1367)', () => {
    mockCategoryParameters = [{ id: '11323', name: 'Stan', type: 'dictionary', required: true }];
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
        connection={connection}
        canBrowseCategories={true}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.getByText('Category parameters')).toBeInTheDocument();
    expect(screen.getByTestId('category-parameters-step')).toBeInTheDocument();
  });

  it('hides the category-parameter step for a borrows destination even with required params (#1367)', () => {
    mockCategoryParameters = [{ id: '11323', name: 'Stan', type: 'dictionary', required: true }];
    renderWithProviders(
      <BulkEditModal
        open
        onOpenChange={() => undefined}
        row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
        connection={connection}
        canBrowseCategories={false}
        currency="PLN"
        defaults={DEFAULTS}
        onSave={() => undefined}
      />,
    );

    expect(screen.queryByText('Category parameters')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Allegro category ID')).toBeInTheDocument();
  });

  describe('multi-variant editor (#1741)', () => {
    it('renders the variant rail labelled by distinguishing attribute and a per-variant EAN field', () => {
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );

      // Rail exposes the shared base + one radio per variant, labelled by attr.
      expect(screen.getByRole('radiogroup', { name: 'Variant scope selector' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Shared base/ })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Rozmiar: M/ })).toBeInTheDocument();
      // Opened focused on var_m → its EAN field is present + prefilled from master.
      expect(screen.getByLabelText('EAN for Rozmiar: M')).toHaveValue('5900531001130');
    });

    it('pre-fills the inherited base price as the per-variant Price value, and toggles override on divergence (#1741)', () => {
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );

      // Batch policy defaults to use-master; the variant's master price is 12,
      // shown as the actual input VALUE (not a placeholder).
      const priceInput = screen.getByLabelText('Price for Rozmiar: M');
      expect(priceInput).toHaveValue('12.00');
      // Un-overridden -> inherited badge, no reset control.
      expect(screen.queryByText(/reset to base/)).not.toBeInTheDocument();

      // Typing a different value flips to overridden (reset control appears).
      fireEvent.change(priceInput, { target: { value: '15.00' } });
      expect(screen.getByText(/reset to base/)).toBeInTheDocument();
      expect(priceInput).toHaveValue('15.00');

      // Typing the exact base value back reverts to inherited (no reset control).
      fireEvent.change(priceInput, { target: { value: '12.00' } });
      expect(screen.queryByText(/reset to base/)).not.toBeInTheDocument();
    });

    it('renders a dictionary category-param override as an inheritable select showing the base value (#1741)', () => {
      mockCategoryParameters = [
        {
          id: 'p_color',
          name: 'Kolor',
          type: 'dictionary',
          required: false,
          restrictions: {},
          dictionary: [
            { id: 'red', value: 'Czerwony' },
            { id: 'blue', value: 'Niebieski' },
          ],
        },
      ];
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeMultiRow(), editFormValues: { parameters: { p_color: 'blue' } } }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );

      // A dictionary param renders as a <select>, not a free-text input.
      const select = screen.getByLabelText('Kolor for Rozmiar: M');
      expect(select.tagName).toBe('SELECT');
      // The inherit sentinel surfaces the concrete base value (id blue -> label).
      expect(
        within(select).getByRole('option', { name: 'Inherit from base (Niebieski)' }),
      ).toBeInTheDocument();
      expect(within(select).getByRole('option', { name: 'Czerwony' })).toBeInTheDocument();
    });

    it('flips a dictionary param to overridden with a reset control when an option is picked (#1741)', () => {
      mockCategoryParameters = [
        {
          id: 'p_color',
          name: 'Kolor',
          type: 'dictionary',
          required: false,
          restrictions: {},
          dictionary: [
            { id: 'red', value: 'Czerwony' },
            { id: 'blue', value: 'Niebieski' },
          ],
        },
      ];
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeMultiRow(), editFormValues: { parameters: { p_color: 'blue' } } }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );

      // Inherited -> no reset control yet.
      expect(screen.queryByText(/reset to base/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Kolor for Rozmiar: M'), { target: { value: 'red' } });

      // Overriding surfaces a reset-to-base affordance for the field.
      expect(screen.getByText(/reset to base/)).toBeInTheDocument();
      expect(screen.getByLabelText('Kolor for Rozmiar: M')).toHaveValue('red');
    });

    it('collapses optional variant params behind a "Show optional fields" expander (#1741)', () => {
      mockCategoryParameters = [
        { id: 'p_req', name: 'Wymagany', type: 'string', required: true, restrictions: {} },
        { id: 'p_opt', name: 'Opcjonalny', type: 'string', required: false, restrictions: {} },
      ];
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );

      // Required param is rendered immediately, outside any expander.
      const required = screen.getByLabelText('Wymagany for Rozmiar: M');
      expect(required.closest('details')).toBeNull();

      // Optional param lives inside a collapsed "Show optional fields (1)" expander.
      expect(screen.getByText('Show optional fields (1)')).toBeInTheDocument();
      const optional = screen.getByLabelText('Opcjonalny for Rozmiar: M');
      const details = optional.closest('details');
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute('open');

      // Opening the expander reveals it.
      fireEvent.click(screen.getByText('Show optional fields (1)'));
      expect(optional.closest('details')).toHaveAttribute('open');
    });

    it('hides a dependsOn-gated variant param until its parent qualifies, matching base (#1741)', () => {
      mockCategoryParameters = [
        {
          id: 'p_parent',
          name: 'Rodzaj',
          type: 'dictionary',
          required: true,
          restrictions: {},
          dictionary: [{ id: 'a', value: 'A' }],
        },
        {
          id: 'p_gated',
          name: 'Zalezny',
          type: 'string',
          required: false,
          restrictions: {},
          dependsOn: { parameterId: 'p_parent', valueIds: ['a'] },
        },
      ];

      // Parent unset -> the gated optional param is hidden (no expander at all).
      const { unmount } = renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );
      expect(screen.queryByLabelText('Zalezny for Rozmiar: M')).not.toBeInTheDocument();
      expect(screen.queryByText(/Show optional fields/)).not.toBeInTheDocument();
      unmount();

      // Parent set (via base params) -> the gated param appears in the expander.
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeMultiRow(), editFormValues: { parameters: { p_parent: 'a' } } }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={() => undefined}
        />,
      );
      expect(screen.getByText('Show optional fields (1)')).toBeInTheDocument();
      expect(screen.getByLabelText('Zalezny for Rozmiar: M')).toBeInTheDocument();
    });

    describe('grouping-param per-variant override (#1741)', () => {
      const stanParam = {
        id: 'p_stan',
        name: 'Stan',
        type: 'dictionary',
        required: true,
        restrictions: {},
        dictionary: [
          { id: 'new', value: 'Nowy' },
          { id: 'uzy', value: 'Uzywany' },
        ],
      };
      const colorParam = {
        id: 'p_color',
        name: 'Kolor',
        type: 'dictionary',
        required: true,
        restrictions: {},
        dictionary: [{ id: 'red', value: 'Czerwony' }],
      };

      function renderWithParams(): void {
        renderWithProviders(
          <BulkEditModal
            open
            onOpenChange={() => undefined}
            row={{ ...makeMultiRow(), editFormValues: { parameters: { p_stan: 'new' } } }}
            connection={connection}
            canBrowseCategories={true}
            currency="PLN"
            defaults={DEFAULTS}
            focusVariantId="var_m"
            onSave={() => undefined}
          />,
        );
      }

      it('locks a base-only grouping param read-only with an override affordance; non-grouping stays editable', () => {
        mockCategoryParameters = [stanParam, colorParam];
        renderWithParams();

        // Grouping param (Stan) is read-only, showing the base label, with the
        // quiet "Override for this variant" affordance.
        expect(screen.getByText('Override for this variant')).toBeInTheDocument();
        const stanField = screen.getByDisplayValue('Nowy');
        expect(stanField).toHaveAttribute('readonly');
        // Non-grouping param (Kolor) renders its normal editable select.
        expect(screen.getByLabelText('Kolor for Rozmiar: M').tagName).toBe('SELECT');
      });

      it('reveals a warning before unlocking, then makes it editable with a "splits listing" badge', () => {
        mockCategoryParameters = [stanParam];
        renderWithParams();

        fireEvent.click(screen.getByText('Override for this variant'));
        expect(screen.getByText(/splits it into its own Allegro listing/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep shared' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Override anyway' }));
        const stanSelect = screen.getByLabelText('Stan for Rozmiar: M');
        expect(stanSelect.tagName).toBe('SELECT');
        // Seeded with the base value so it starts equal to base, then editable.
        expect(stanSelect).toHaveValue('new');
        expect(screen.getByText('splits listing')).toBeInTheDocument();
        expect(screen.getByText(/reset to base/)).toBeInTheDocument();
      });

      it('reset-to-base returns the grouping param to inherited and clears the override', () => {
        mockCategoryParameters = [stanParam];
        renderWithParams();

        fireEvent.click(screen.getByText('Override for this variant'));
        fireEvent.click(screen.getByRole('button', { name: 'Override anyway' }));
        expect(screen.getByText('splits listing')).toBeInTheDocument();

        fireEvent.click(screen.getByText(/reset to base/));
        expect(screen.getByText('Override for this variant')).toBeInTheDocument();
        expect(screen.queryByText('splits listing')).not.toBeInTheDocument();
      });

      it('"Keep shared" collapses the warning back to the inherited state', () => {
        mockCategoryParameters = [stanParam];
        renderWithParams();

        fireEvent.click(screen.getByText('Override for this variant'));
        fireEvent.click(screen.getByRole('button', { name: 'Keep shared' }));
        expect(screen.queryByText(/splits it into its own Allegro listing/)).not.toBeInTheDocument();
        expect(screen.getByText('Override for this variant')).toBeInTheDocument();
      });
    });

    it('emits a per-variant EAN override when the operator edits a sibling EAN', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={onSave}
        />,
      );

      // Replace var_m's EAN with a different valid GTIN-13.
      fireEvent.change(screen.getByLabelText('EAN for Rozmiar: M'), {
        target: { value: '5901234567897' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const perVariant = onSave.mock.calls[0][2] as Record<string, { overrides?: { ean?: string } }>;
      expect(perVariant.var_m?.overrides?.ean).toBe('5901234567897');
      // The untouched sibling writes no EAN override.
      expect(perVariant.var_s?.overrides?.ean).toBeUndefined();
      // Inclusion map covers both siblings.
      const included = onSave.mock.calls[0][3] as Record<string, boolean>;
      expect(included).toEqual({ var_s: true, var_m: true });
    });
  });

  describe('per-product pricing/stock policy (#1741)', () => {
    it('renders Price/Stock policy selects seeded from the batch policy on the multi-variant base scope', () => {
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          pricingPolicy={{ mode: 'markup', percent: 15 }}
          stockPolicy={{ mode: 'use-master' }}
          onSave={() => undefined}
        />,
      );
      expect(screen.getByLabelText('Price policy')).toHaveValue('markup');
      expect(screen.getByLabelText('Stock policy')).toHaveValue('use-master');
      expect(screen.getByLabelText('Markup percent')).toHaveValue('15');
    });

    it('keeps the simple product on explicit Price/Stock inputs (no policy selects)', () => {
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeRow()}
          connection={connection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          pricingPolicy={{ mode: 'markup', percent: 15 }}
          stockPolicy={{ mode: 'use-master' }}
          onSave={() => undefined}
        />,
      );
      expect(screen.queryByLabelText('Price policy')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Stock policy')).not.toBeInTheDocument();
    });

    it('emits a per-product policy override only when it diverges from the batch default', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          pricingPolicy={{ mode: 'use-master' }}
          stockPolicy={{ mode: 'use-master' }}
          onSave={onSave}
        />,
      );

      // Diverge pricing to Flat 99; leave stock inheriting the batch default.
      fireEvent.change(screen.getByLabelText('Price policy'), { target: { value: 'flat' } });
      fireEvent.change(screen.getByLabelText('Flat price'), { target: { value: '99' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const baseOverride = onSave.mock.calls[0][1] as {
        pricingPolicy?: { mode: string; amount?: number };
        stockPolicy?: { mode: string };
      };
      expect(baseOverride.pricingPolicy).toEqual({ mode: 'flat', amount: 99 });
      // Stock left on the batch default -> no override emitted.
      expect(baseOverride.stockPolicy).toBeUndefined();
    });

    it('emits no policy override when the operator leaves both selects on the batch default', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeMultiRow()}
          connection={connection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          pricingPolicy={{ mode: 'markup', percent: 10 }}
          stockPolicy={{ mode: 'use-master' }}
          onSave={onSave}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const baseOverride = onSave.mock.calls[0][1] as {
        pricingPolicy?: unknown;
        stockPolicy?: unknown;
      };
      expect(baseOverride.pricingPolicy).toBeUndefined();
      expect(baseOverride.stockPolicy).toBeUndefined();
    });
  });

  // #1741 - the EAN/GTIN category parameter is hidden from the rendered
  // category-parameters UI (base + variant); its value is owned by the dedicated
  // offer-EAN field and re-injected into the submitted parameters[].
  describe('de-duplicated EAN category parameter (#1741)', () => {
    const eanParam = {
      id: 'p_ean',
      name: 'EAN (GTIN)',
      type: 'string',
      required: false,
      restrictions: {},
      section: 'product',
    };
    // A neutral, non-EAN, non-grouping param so it renders as its own field in
    // both scopes (avoids the base-only Marka/Stan read-only branch).
    const materialParam = {
      id: 'p_material',
      name: 'Material',
      type: 'string',
      required: false,
      restrictions: {},
      section: 'product',
    };

    it('filters the EAN/GTIN param out of the base-scope category-parameters step', () => {
      mockCategoryParameters = [eanParam, materialParam];
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          onSave={() => undefined}
        />,
      );

      const step = screen.getByTestId('category-parameters-step');
      expect(step).toHaveTextContent('Material');
      expect(step).not.toHaveTextContent('EAN');
    });

    it('injects the dedicated offer-EAN into the submitted parameters[] GTIN slot on a simple product', async () => {
      mockCategoryParameters = [eanParam];
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeRow(), resolvedCategoryId: 'cat-1' }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          onSave={onSave}
        />,
      );

      // Master barcode ('590') pre-fills the dedicated offer-EAN field.
      const eanField = screen.getByLabelText('EAN (GTIN)');
      expect(eanField).toHaveValue('590');
      fireEvent.change(eanField, { target: { value: '5901234123457' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const baseOverride = onSave.mock.calls[0][1] as {
        overrides?: { parameters?: Array<{ id: string; values?: string[]; section: string }> };
      };
      expect(baseOverride.overrides?.parameters).toEqual([
        { id: 'p_ean', values: ['5901234123457'], section: 'product' },
      ]);
    });

    it('hides the EAN/GTIN param in a variant scope and injects the master EAN into its parameters[] slot', async () => {
      mockCategoryParameters = [eanParam, materialParam];
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={{ ...makeMultiRow(), resolvedCategoryId: 'cat-1' }}
          connection={connection}
          canBrowseCategories={true}
          currency="PLN"
          defaults={DEFAULTS}
          focusVariantId="var_m"
          onSave={onSave}
        />,
      );

      // The dedicated per-variant EAN field is present and pre-filled from master;
      // the borrowed EAN category parameter is NOT rendered as its own field.
      expect(screen.getByLabelText('EAN for Rozmiar: M')).toHaveValue('5900531001130');
      expect(screen.queryByLabelText('EAN (GTIN) for Rozmiar: M')).not.toBeInTheDocument();
      // A non-EAN param still renders as a variant field.
      expect(screen.getByLabelText('Material for Rozmiar: M')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const perVariant = onSave.mock.calls[0][2] as Record<
        string,
        { overrides?: { parameters?: Array<{ id: string; values?: string[]; section: string }> } }
      >;
      expect(perVariant.var_m?.overrides?.parameters).toContainEqual({
        id: 'p_ean',
        values: ['5900531001130'],
        section: 'product',
      });
    });
  });

  // #1530 - per-row delivery-price-list override in the bulk edit modal.
  describe('delivery price list override (#1530)', () => {
    it('inherits the batch default and saves no per-row override when left unchanged', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeRow()}
          connection={erliConnection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          batchDeliveryPriceList="*"
          onSave={onSave}
        />,
        { apiClient: erliApiClient() },
      );

      await screen.findByRole('option', { name: 'Kurier' }, { timeout: 4000 });
      expect(screen.getByLabelText('Delivery price list')).toHaveValue('*');
      expect(screen.getByText('Batch default')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const baseOverride = onSave.mock.calls[0][1] as {
        overrides?: { platformParams?: Record<string, unknown> };
      };
      expect(baseOverride.overrides?.platformParams?.deliveryPriceList).toBeUndefined();
    });

    it('writes the per-row override so it wins over the batch default', async () => {
      const onSave = vi.fn();
      renderWithProviders(
        <BulkEditModal
          open
          onOpenChange={() => undefined}
          row={makeRow()}
          connection={erliConnection}
          canBrowseCategories={false}
          currency="PLN"
          defaults={DEFAULTS}
          batchDeliveryPriceList="*"
          onSave={onSave}
        />,
        { apiClient: erliApiClient() },
      );

      await screen.findByRole('option', { name: 'Kurier' }, { timeout: 4000 });
      fireEvent.change(screen.getByLabelText('Delivery price list'), {
        target: { value: 'Kurier' },
      });

      expect(screen.getByRole('button', { name: 'Reset to batch default' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Save all' }));

      await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1); });
      const baseOverride = onSave.mock.calls[0][1] as {
        overrides?: { platformParams?: Record<string, unknown> };
      };
      expect(baseOverride.overrides?.platformParams?.deliveryPriceList).toBe('Kurier');
    });
  });
});
