import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { VariantCostCell, VariantCostSection } from './variant-cost';
import type { ProductVariant, VariantCost } from '../../features/products/api/products.types';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';

afterEach(cleanup);

const adminAdapter = createAuthenticatedSessionAdapter({
  id: 'u1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['products:write'],
  analyticsConsent: true,
});
const viewerAdapter = createAuthenticatedSessionAdapter({
  id: 'u2',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: [],
  analyticsConsent: true,
});

const VARIANT: ProductVariant = {
  id: 'ol_variant_1',
  productId: 'ol_product_1',
  sku: 'KUB-350-BIA',
  attributes: null,
  ean: null,
  gtin: null,
  price: 49.99,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  isStale: false,
  staleAt: null,
};

function cost(overrides: Partial<VariantCost>): VariantCost {
  return {
    variantId: VARIANT.id,
    sku: VARIANT.sku,
    netUnitCost: '22.8000',
    costCurrency: 'PLN',
    costUpdatedAt: '2026-09-24T14:02:00.000Z',
    costUpdatedByUserId: 'u1',
    ...overrides,
  };
}

function renderWith(
  ui: React.ReactElement,
  rows: VariantCost[],
  options: { adapter?: typeof adminAdapter; setVariantCost?: Mock; demoMode?: boolean } = {}
): Mock {
  const setVariantCost: Mock = options.setVariantCost ?? vi.fn().mockResolvedValue(cost({}));
  renderWithProviders(ui, {
    apiClient: createMockApiClient({
      products: {
        getVariantCosts: vi.fn().mockResolvedValue(rows),
        setVariantCost: setVariantCost as never,
      },
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: options.demoMode ?? false }) },
    }),
    sessionAdapter: options.adapter ?? adminAdapter,
  });
  return setVariantCost;
}

describe('VariantCostCell', () => {
  it('should show the net cost with its currency when recorded', async () => {
    renderWith(<VariantCostCell variant={VARIANT} />, [cost({})]);
    expect(await screen.findByText('PLN 22.80')).toBeInTheDocument();
  });

  it('should show 0.00 as a real cost, not as not recorded', async () => {
    renderWith(<VariantCostCell variant={VARIANT} />, [cost({ netUnitCost: '0.0000' })]);
    expect(await screen.findByText('PLN 0.00')).toBeInTheDocument();
    expect(screen.queryByText('Not recorded')).not.toBeInTheDocument();
  });

  it('should show a Not recorded badge when the variant has no cost', async () => {
    renderWith(<VariantCostCell variant={VARIANT} />, [
      cost({ netUnitCost: null, costCurrency: null, costUpdatedAt: null }),
    ]);
    expect(await screen.findByText('Not recorded')).toBeInTheDocument();
  });
});

describe('VariantCostSection', () => {
  const section = (
    <VariantCostSection variant={VARIANT} productCurrency="PLN" sourceName="PrestaShop" />
  );

  it('should name the source connection in the never-synced note', async () => {
    renderWith(section, [cost({})]);
    expect(await screen.findByTestId('variant-cost-provenance-kub-350-bia')).toBeInTheDocument();
    expect(
      screen.getByText('The PrestaShop sync never changes or clears this value.')
    ).toBeInTheDocument();
  });

  it('should reject a malformed cost and not call the API', async () => {
    const user = userEvent.setup();
    const set = renderWith(section, [cost({ netUnitCost: null, costCurrency: null })]);
    await user.click(await screen.findByTestId('variant-cost-add-kub-350-bia'));
    await user.type(screen.getByTestId('variant-cost-input'), '19.999');
    await user.click(screen.getByTestId('variant-cost-save'));
    expect(await screen.findByTestId('variant-cost-error')).toBeVisible();
    expect(set).not.toHaveBeenCalled();
  });

  it('should save a comma decimal as a dot with the chosen currency', async () => {
    const user = userEvent.setup();
    const set = renderWith(section, [cost({ netUnitCost: null, costCurrency: null })]);
    await user.click(await screen.findByTestId('variant-cost-add-kub-350-bia'));
    await user.type(screen.getByTestId('variant-cost-input'), '19,6');
    await user.click(screen.getByTestId('variant-cost-save'));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('ol_variant_1', { netUnitCost: '19.6', currency: 'PLN' })
    );
  });

  it('should close the form without saving on Cancel', async () => {
    const user = userEvent.setup();
    const set = renderWith(section, [cost({})]);
    await user.click(await screen.findByTestId('variant-cost-edit-kub-350-bia'));
    expect(screen.getByTestId('variant-cost-form-kub-350-bia')).toBeInTheDocument();
    await user.click(screen.getByTestId('variant-cost-cancel'));
    expect(screen.queryByTestId('variant-cost-form-kub-350-bia')).not.toBeInTheDocument();
    expect(set).not.toHaveBeenCalled();
  });

  it('should clear the cost by sending both fields as null', async () => {
    const user = userEvent.setup();
    const set = renderWith(section, [cost({})]);
    await user.click(await screen.findByTestId('variant-cost-clear-kub-350-bia'));
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('ol_variant_1', { netUnitCost: null, currency: null })
    );
  });

  it('should disable Edit cost with the reason for a user without products:write', async () => {
    renderWith(section, [cost({})], { adapter: viewerAdapter });
    const edit = await screen.findByTestId('variant-cost-edit-kub-350-bia');
    expect(edit).toBeDisabled();
    expect(screen.getByTestId('variant-cost-readonly-reason')).toHaveTextContent(
      'Only an admin can change cost prices.'
    );
    expect(screen.queryByTestId('variant-cost-clear-kub-350-bia')).not.toBeInTheDocument();
  });

  it('should lock Edit cost behind the demo tooltip for a demo viewer, without the admin-only reason', async () => {
    renderWith(section, [cost({})], { adapter: viewerAdapter, demoMode: true });
    const edit = await screen.findByTestId('variant-cost-edit-kub-350-bia');
    await waitFor(() => expect(edit.closest('.read-only-lock')).not.toBeNull());
    expect(edit).toBeDisabled();
    expect(screen.queryByTestId('variant-cost-readonly-reason')).not.toBeInTheDocument();
  });
});
