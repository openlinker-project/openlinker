/**
 * BulkReviewStep tests (#792 PR 3)
 *
 * Multi-chip status cell, computed-value provenance badges, currency-mismatch
 * price rendering, and the blockers-driven "Approve all" gate.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkReviewStep } from './bulk-review-step';
import type { BulkRowBlocker, BulkWizardRow, PricingPolicy, StockPolicy } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';

// jsdom has no matchMedia; force desktop (table, not card view) for the DataTable.
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function makeRow(
  productId: string,
  blockers: BulkRowBlocker[],
  opts: {
    masterPrice?: number | null;
    masterStock?: number | null;
    masterCurrency?: string | null;
    resolvedCategoryId?: string | null;
  } = {},
): BulkWizardRow {
  const variant: ProductVariant = {
    id: `var_${productId}`,
    productId,
    sku: 'SKU',
    attributes: null,
    ean: '590',
    gtin: null,
    price: opts.masterPrice ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const product: Product = {
    id: productId,
    name: `Product ${productId}`,
    sku: 'SKU',
    price: opts.masterPrice ?? null,
    currency: opts.masterCurrency ?? 'PLN',
    description: null,
    images: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  return {
    productId,
    product,
    primaryVariant: variant,
    blockers,
    resolvedCategoryId: opts.resolvedCategoryId ?? (blockers.length === 0 ? 'cat-A' : null),
    resolutionMethod: null,
    masterPrice: opts.masterPrice ?? null,
    masterStock: opts.masterStock ?? null,
    masterCurrency: opts.masterCurrency ?? 'PLN',
    categoryCandidates: [],
    override: {},
  };
}

function renderReview(
  rows: BulkWizardRow[],
  pricingPolicy: PricingPolicy = { mode: 'use-master' },
  stockPolicy: StockPolicy = { mode: 'use-master' },
) {
  return renderWithProviders(
    <BulkReviewStep
      rows={rows}
      connectionId="conn_1"
      pricingPolicy={pricingPolicy}
      stockPolicy={stockPolicy}
      currency="PLN"
      publishImmediately
      onUpdateRow={() => undefined}
      onApproveAll={() => undefined}
      onBack={() => undefined}
    />,
  );
}

describe('BulkReviewStep', () => {
  it('renders one chip per active blocker', () => {
    renderReview([makeRow('a', ['no-ean', 'no-master-price'])]);
    expect(screen.getByText('no EAN')).toBeInTheDocument();
    expect(screen.getByText('no master price')).toBeInTheDocument();
  });

  it('renders a ready chip when a row has no blockers', () => {
    renderReview([makeRow('a', [], { masterPrice: 12, masterStock: 5 })]);
    // Scope to the table — the summary line also contains the word "ready".
    expect(within(screen.getByRole('table')).getByText('ready')).toBeInTheDocument();
  });

  it('shows a POLICY provenance badge for a markup-computed price', () => {
    renderReview(
      [makeRow('a', [], { masterPrice: 12, masterStock: 5 })],
      { mode: 'markup', percent: 10 },
    );
    expect(screen.getByText('13.20 PLN')).toBeInTheDocument();
    expect(screen.getByText('POLICY')).toBeInTheDocument();
  });

  it('renders a currency-mismatch chip and dashes the price column', () => {
    renderReview(
      [makeRow('a', ['currency-mismatch'], { masterPrice: 200, masterStock: 5, masterCurrency: 'EUR' })],
      { mode: 'markup', percent: 10 },
    );
    expect(screen.getByText('currency mismatch')).toBeInTheDocument();
    // No converted figure rendered — the price column shows an em dash, never "EUR" / "PLN".
    expect(screen.queryByText(/PLN/)).not.toBeInTheDocument();
  });

  it('disables Approve all while a listable row has blockers and enables it when all are ready', () => {
    const { rerender } = renderReview([
      makeRow('a', [], { masterPrice: 12, masterStock: 5 }),
      makeRow('b', ['no-ean']),
    ]);
    expect(screen.getByRole('button', { name: /Approve all/ })).toBeDisabled();

    rerender(
      <BulkReviewStep
        rows={[makeRow('a', [], { masterPrice: 12, masterStock: 5 })]}
        connectionId="conn_1"
        pricingPolicy={{ mode: 'use-master' }}
        stockPolicy={{ mode: 'use-master' }}
        currency="PLN"
        publishImmediately
        onUpdateRow={() => undefined}
        onApproveAll={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /Approve all/ })).toBeEnabled();
  });

  it('does not count no-variant rows as blocking the gate', () => {
    const noVariantRow: BulkWizardRow = {
      ...makeRow('skip', ['no-variant']),
      primaryVariant: null,
    };
    renderReview([makeRow('a', [], { masterPrice: 12, masterStock: 5 }), noVariantRow]);
    expect(screen.getByRole('button', { name: /Approve all/ })).toBeEnabled();
  });
});
