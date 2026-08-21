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

/**
 * Build a DISTINCT, checksum-valid EAN-13 per variant id.
 *
 * Every variant used to share one hardcoded barcode, which the backend would
 * reject outright (`enforceIdentifierRules` throws `DuplicateBatchEanException`
 * when one identifier covers more than one included variant), and which the
 * batch-wide duplicate gate now blocks client-side too (#1934/F7). Deriving a
 * unique code per id keeps the fixture representative of a submittable batch.
 */
function eanFor(id: string): string {
  let seed = 0;
  for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) % 1_000_000;
  const body = `590${String(seed).padStart(9, '0')}`;
  let sum = 0;
  for (let i = body.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += Number(body[i]) * (pos % 2 === 0 ? 3 : 1);
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function variantRow(id: string, blockers: BulkRowBlocker[] = [], over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: id },
    ean: eanFor(id),
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
    batchIssues: [],
    canBrowseCategories: true,
    demoReadOnly: false,
    alreadyListedVariantIds: new Set<string>(),
    destinationName: 'Test Marketplace',
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
    expect(screen.getByRole('button', { name: /Fix: no barcode - Rozmiar: v1/ })).toBeInTheDocument();
  });

  it('carries the cause sentence on the chip so one chip can explain itself (#2240)', () => {
    renderWithProviders(
      <BulkReviewStep rows={[makeRow('prod_1', [variantRow('v1', ['no-match'])])]} {...baseProps()} />,
    );
    // One chip per cause in the table - the sentence rides in the title/accessible
    // name rather than in a second, always-present "category not set" chip.
    const chip = screen.getByRole('button', { name: /Fix: no catalog match - Rozmiar: v1/ });
    expect(chip).toHaveAttribute(
      'title',
      expect.stringContaining("isn't in the Test Marketplace catalog"),
    );
    expect(screen.queryByText('category not set')).not.toBeInTheDocument();
  });

  it('LOCKS the submit while a batch-level precondition is unmet (#2240 review)', () => {
    // Not a soft warning: the precondition is connection-wide and
    // deterministic, so no subset of this batch can succeed and a banner an
    // operator can read past would explain the wasted batch instead of
    // preventing it.
    renderWithProviders(
      <BulkReviewStep
        rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]}
        {...baseProps()}
        batchIssues={[
          {
            id: 'allegro:missing-seller-details',
            title: 'This connection is missing a responsible producer.',
            detail: 'Allegro requires them on every offer.',
          },
        ]}
      />,
    );

    for (const button of screen.getAllByRole('button', { name: /Create offers/ })) {
      expect(button).toBeDisabled();
    }
    // And the readiness line must not still claim every variant is ready.
    expect(screen.queryByText(/All included variants are ready/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/This connection is not set up to create offers yet/),
    ).toBeInTheDocument();
  });

  it('warns once for the batch when the platform reports an unmet precondition (#2240)', () => {
    renderWithProviders(
      <BulkReviewStep
        rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]}
        {...baseProps()}
        batchIssues={[
          {
            id: 'allegro:missing-seller-details',
            title: 'This connection is missing a responsible producer.',
            detail: 'Allegro requires them on every offer, so each one will be rejected.',
          },
        ]}
      />,
    );
    expect(
      screen.getByText('This connection is missing a responsible producer.'),
    ).toBeInTheDocument();
    // One banner for the batch, not one per variant.
    expect(screen.getAllByText(/Allegro requires them on every offer/)).toHaveLength(1);
  });

  it('opens the shared image lightbox from the product thumbnail (#1741)', () => {
    renderWithProviders(
      <BulkReviewStep rows={[makeRow('prod_1', [variantRow('v1'), variantRow('v2')])]} {...baseProps()} />,
    );
    expect(screen.queryByRole('button', { name: 'Close image' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Zoom image of Doniczka Terra/ }));
    expect(screen.getByRole('button', { name: 'Close image' })).toBeInTheDocument();
  });

  it('renders the "already on {destination}" chip with an aria-hidden decorative dot (#1838)', () => {
    renderWithProviders(
      <BulkReviewStep
        rows={[makeRow('prod_1', [variantRow('v1')])]}
        {...baseProps()}
        alreadyListedVariantIds={new Set(['v1'])}
      />,
    );
    const chip = screen.getByText(/already on Test Marketplace/);
    const dot = chip.parentElement?.querySelector('.bulk-chip__dot');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });
});
