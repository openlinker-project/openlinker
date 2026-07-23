/**
 * BulkReviewStep tests (#1741)
 *
 * Per-variant expandable review: tri-state parent include, per-variant chips,
 * include/exclude gating, and the canApprove ("Create offers") gate.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkReviewStep } from './bulk-review-step';
import type { BulkRowBlocker, BulkVariantRow, BulkWizardConfig, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';
import type { Connection } from '../../../connections';

const connection: Connection = {
  id: 'conn_1',
  name: 'My Allegro',
  platformType: 'allegro',
  status: 'active',
  config: {},
  credentialsBacked: true,
  enabledCapabilities: ['OfferManager'],
  supportedCapabilities: ['OfferManager', 'EanCategoryMatcher', 'CategoryBrowser'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as Connection;

const config: BulkWizardConfig = {
  connectionId: 'conn_1',
  platformParams: {},
  currency: 'PLN',
  pricingPolicy: { mode: 'use-master' },
  stockPolicy: { mode: 'use-master' },
  publishImmediately: true,
  generateDescription: false,
};

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

function variantRow(id: string, blockers: BulkRowBlocker[] = [], over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: id },
    ean: '5901234123457',
    gtin: null,
    price: 39,
  } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
    masterStock: 10,
    masterPrice: 39,
    masterCurrency: 'PLN',
    included: true,
    blockers,
    resolvedCategoryId: 'cat-1',
    resolvedProductCardId: 'card-1',
    resolutionMethod: 'auto_detect',
    categoryCandidates: [],
    override: {},
    ...over,
  };
}

function makeRow(productId: string, variants: BulkVariantRow[]): BulkWizardRow {
  return {
    productId,
    product: { id: productId, name: 'Doniczka Terra', images: ['a.jpg'] } as unknown as Product,
    primaryVariant: variants[0]?.variant ?? null,
    variants,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: 39,
    masterStock: null,
    masterCurrency: 'PLN',
    categoryCandidates: [],
    override: {},
  };
}

function baseProps() {
  return {
    connection,
    config,
    paramsResolving: false,
    platformBlockerChips: [],
    canBrowseCategories: true,
    demoReadOnly: false,
    onSetVariantIncluded: vi.fn(),
    onSetProductIncluded: vi.fn(),
    onSaveEditor: vi.fn(),
    onApproveAll: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('BulkReviewStep', () => {
  it('enables Create offers when every included variant is ready', () => {
    renderWithProviders(
      <BulkReviewStep rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]} {...baseProps()} />,
    );
    // Rendered three times (desktop top-right + two mobile copies); assert all enabled.
    const create = screen.getAllByRole('button', { name: /Create offers \(2\)/ });
    expect(create.length).toBeGreaterThan(0);
    create.forEach((btn) => expect(btn).not.toBeDisabled());
  });

  it('disables Create offers when an included variant needs attention', () => {
    renderWithProviders(
      <BulkReviewStep
        rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2', ['no-match'])])]}
        {...baseProps()}
      />,
    );
    screen
      .getAllByRole('button', { name: /Create offers \(1\)/ })
      .forEach((btn) => expect(btn).toBeDisabled());
  });

  it('tri-state parent toggle includes/excludes all variants', () => {
    const onSetProductIncluded = vi.fn();
    renderWithProviders(
      <BulkReviewStep
        rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]}
        {...baseProps()}
        onSetProductIncluded={onSetProductIncluded}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Include all Doniczka Terra variants/));
    expect(onSetProductIncluded).toHaveBeenCalledWith('prod_1', false);
  });

  it('renders a fix chip as a button with the variant identity in its accessible name', () => {
    renderWithProviders(
      <BulkReviewStep rows={[makeRow('prod_1', [variantRow('v1', ['no-ean'])])]} {...baseProps()} />,
    );
    // Single-variant product renders flat; its blocker chip is a fix button.
    // The accessible name carries the human variant label (distinguishing attr),
    // never the raw ol_variant id (#1741 review).
    expect(screen.getByRole('button', { name: /Fix: no EAN - Rozmiar: v1/ })).toBeInTheDocument();
  });

  it('opens the shared image lightbox from the product thumbnail (#1741)', () => {
    renderWithProviders(
      <BulkReviewStep rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]} {...baseProps()} />,
    );
    expect(screen.queryByRole('button', { name: 'Close image' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zoom image of Doniczka Terra/ }));
    expect(screen.getByRole('button', { name: 'Close image' })).toBeInTheDocument();
  });
});
