/**
 * BulkWizard pure-reducer + demo-instrumentation tests (#792 / #1741 / #1788)
 *
 * Pins `mergeResolveOutcomes`: per-variant resolve outcomes are folded into each
 * row's `variants[]` by variant id, preserving operator overrides; rows without
 * a matching outcome keep their identity.
 *
 * Also pins `destinationResolvesCategoryAtSubmit` (#2211): the two-source
 * derivation that decides whether a pre-flight `no-match` reaches the operator
 * as a blocker at all. Getting it wrong is silent in both directions - too
 * strict asks for a category the destination never looks up, too lax turns the
 * whole Review green and kills every child on `categoryId / REQUIRED`.
 */
import { fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../../test/test-utils';
import { BulkWizard, mergeResolveOutcomes, seedRows } from './bulk-wizard';
import type {
  BulkResolveCompletion,
  BulkResolveOutcome,
  BulkResolveVariantOutcome,
} from './bulk-resolve-step';
import type { BulkVariantRow, BulkWizardRow } from './bulk-wizard.types';
import type { Product, ProductVariant } from '../../../products';
import type { Connection } from '../../../connections';

const captureDemoEvent = vi.fn();
vi.mock('../../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

/** The subset of the Resolve step's props these tests drive or observe. */
interface ResolveStepStubProps {
  destinationResolvesCategoryAtSubmit?: boolean;
  onComplete: (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => void;
}

/**
 * Test-controlled stand-in for the Resolve step. Stubbed rather than driven
 * through its real stream on purpose: what is under test is the wizard's own
 * derivation, so the step's internals (chunking, retries, progress copy) must
 * not be able to fail or flake these assertions.
 */
const resolveStub: {
  received: (boolean | undefined)[];
  outcomes: BulkResolveOutcome[];
  completion: BulkResolveCompletion;
} = {
  received: [],
  outcomes: [],
  completion: { catalogueLookupPerformed: true },
};

vi.mock('./bulk-resolve-step', () => ({
  BulkResolveStep: (props: ResolveStepStubProps) => {
    resolveStub.received.push(props.destinationResolvesCategoryAtSubmit);
    return (
      <button
        type="button"
        onClick={() => {
          props.onComplete(resolveStub.outcomes, resolveStub.completion);
        }}
      >
        finish resolve
      </button>
    );
  },
}));

function makeVariantRow(id: string, over: Partial<BulkVariantRow> = {}): BulkVariantRow {
  const variant = {
    id,
    productId: 'prod_1',
    sku: id,
    attributes: { Rozmiar: 'M' },
    ean: '5901234567897',
    gtin: null,
    price: 39,
  } as unknown as ProductVariant;
  return {
    variantId: id,
    variant,
    ean: variant.ean,
    distinguishingAttributes: variant.attributes,
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

function variantOutcome(
  variantId: string,
  partial: Partial<BulkResolveVariantOutcome> = {},
): BulkResolveVariantOutcome {
  return {
    variantId,
    blockers: [],
    resolvedCategoryId: null,
    resolvedProductCardId: null,
    resolutionMethod: null,
    masterPrice: null,
    masterStock: null,
    masterCurrency: null,
    categoryCandidates: [],
    ean: null,
    ...partial,
  };
}

function outcome(productId: string, variants: BulkResolveVariantOutcome[]): BulkResolveOutcome {
  return { productId, variants };
}

describe('mergeResolveOutcomes', () => {
  it('folds per-variant resolve fields into the matching variant row', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('ol_variant_1')])];
    const next = mergeResolveOutcomes(rows, [
      outcome('prod_1', [
        variantOutcome('ol_variant_1', {
          blockers: ['no-match'],
          resolvedCategoryId: 'cat-A',
          resolvedProductCardId: 'card-A',
          masterStock: 3,
          masterPrice: 12,
          masterCurrency: 'PLN',
        }),
      ]),
    ]);

    expect(next[0].variants[0]).toMatchObject({
      blockers: ['no-match'],
      resolvedCategoryId: 'cat-A',
      resolvedProductCardId: 'card-A',
      masterStock: 3,
    });
  });

  it('preserves each variant operator override across a re-resolve', () => {
    const rows = [
      makeRow('prod_1', [
        makeVariantRow('ol_variant_1', { override: { overrides: { title: 'Kept' } } }),
      ]),
    ];
    const next = mergeResolveOutcomes(rows, [
      outcome('prod_1', [variantOutcome('ol_variant_1', { masterStock: 9 })]),
    ]);
    expect(next[0].variants[0].override.overrides?.title).toBe('Kept');
    expect(next[0].variants[0].masterStock).toBe(9);
  });

  it('leaves a row with no matching outcome unchanged', () => {
    const rows = [makeRow('prod_1', [makeVariantRow('ol_variant_1')])];
    const next = mergeResolveOutcomes(rows, [outcome('prod_2', [])]);
    expect(next[0]).toBe(rows[0]);
  });
});

describe('BulkWizard — demo instrumentation (#1788)', () => {
  beforeEach(() => {
    captureDemoEvent.mockClear();
  });
  afterEach(cleanup);

  it('captures demo_offer_wizard_step_advanced(step=config) with the resolved platform when the config step proceeds', async () => {
    const connection = {
      id: 'conn-1',
      name: 'My Allegro',
      status: 'active',
      platformType: 'allegro',
      supportedCapabilities: ['OfferManager', 'OfferCreator'],
      config: { masterCatalogConnectionId: 'conn-master' },
    } as unknown as Connection;
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([connection]) },
      listings: {
        getSellerPolicies: vi.fn().mockResolvedValue({
          deliveryPolicies: [{ id: 'dp1', name: 'Courier 24h' }],
        }),
      },
    });
    const products: Product[] = [
      { id: 'prod_1', name: 'P', currency: 'PLN' } as unknown as Product,
    ];

    renderWithProviders(
      <BulkWizard
        products={products}
        resolveConnectionName={() => 'My Allegro'}
        preselectedConnectionId="conn-1"
      />,
      { apiClient },
    );

    await screen.findByRole('option', { name: 'Courier 24h' }, { timeout: 5000 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Shipping rate package' }), {
      target: { value: 'dp1' },
    });

    const proceed = screen.getByRole('button', { name: /Proceed/ });
    await waitFor(() => expect(proceed).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(proceed);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_offer_wizard_step_advanced', {
      platform: 'allegro',
      step: 'config',
    });
  }, 15000);
});

describe('BulkWizard — destination context (#2227)', () => {
  afterEach(cleanup);

  it('should name the destination in the heading and show the context bar once Config is left', async () => {
    const connection = {
      id: 'conn-1',
      name: 'My Allegro',
      status: 'active',
      platformType: 'allegro',
      supportedCapabilities: ['OfferManager', 'OfferCreator'],
      config: { environment: 'sandbox', masterCatalogConnectionId: 'conn-master' },
    } as unknown as Connection;
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([connection]) },
      listings: {
        getSellerPolicies: vi.fn().mockResolvedValue({
          deliveryPolicies: [{ id: 'dp1', name: 'Courier 24h' }],
        }),
      },
    });
    const products: Product[] = [
      { id: 'prod_1', name: 'P', currency: 'PLN' } as unknown as Product,
    ];

    renderWithProviders(
      <BulkWizard
        products={products}
        resolveConnectionName={() => 'My Allegro'}
        preselectedConnectionId="conn-1"
      />,
      { apiClient },
    );

    // Config IS the destination form: plain heading, no bar repeating the picker.
    expect(
      await screen.findByRole('heading', { name: 'Bulk marketplace offer creation' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('bulk-destination-bar')).not.toBeInTheDocument();

    await screen.findByRole('option', { name: 'Courier 24h' }, { timeout: 5000 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Shipping rate package' }), {
      target: { value: 'dp1' },
    });
    const proceed = screen.getByRole('button', { name: /Proceed/ });
    await waitFor(() => expect(proceed).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(proceed);

    expect(
      await screen.findByRole('heading', { name: 'Create offers on My Allegro' }),
    ).toBeInTheDocument();
    const bar = screen.getByTestId('bulk-destination-bar');
    expect(bar).toHaveAttribute('data-environment', 'sandbox');
    expect(document.title).toBe('Bulk offers · My Allegro');
  }, 15000);
});

describe('seedRows (#1754 pre-selected variants)', () => {
  function makeProduct(id: string, variantIds: string[]): Product {
    return {
      id,
      name: `Product ${id}`,
      sku: id,
      currency: 'PLN',
      variants: variantIds.map(
        (vid) =>
          ({
            id: vid,
            productId: id,
            sku: vid,
            attributes: { Rozmiar: vid },
            ean: null,
            gtin: null,
            price: 10,
          }) as unknown as ProductVariant,
      ),
    } as unknown as Product;
  }

  it('seeds every variant included when no pre-selection is given', () => {
    const rows = seedRows([makeProduct('p1', ['v1', 'v2', 'v3'])]);
    expect(rows[0].variants.map((v) => v.included)).toEqual([true, true, true]);
  });

  it('keeps ALL variants but includes only the pre-selected one for a variant-scoped product', () => {
    const rows = seedRows([makeProduct('p1', ['v1', 'v2', 'v3'])], new Set(['v2']));
    // All three siblings are still seeded (product stays multi-variant / expandable)...
    expect(rows[0].variants.map((v) => v.variantId)).toEqual(['v1', 'v2', 'v3']);
    // ...but only the picked one starts included; the rest seed excluded.
    expect(rows[0].variants.map((v) => v.included)).toEqual([false, true, false]);
    // Primary represents an included variant, not the bare first sibling.
    expect(rows[0].primaryVariant?.id).toBe('v2');
  });

  it('includes every variant of a whole-product pick even when the set scopes a different product', () => {
    const rows = seedRows(
      [makeProduct('p1', ['v1', 'v2']), makeProduct('p2', ['v3', 'v4'])],
      new Set(['v3']),
    );
    // p1 has no variant in the set -> whole-product pick -> all included.
    expect(rows[0].variants.map((v) => v.included)).toEqual([true, true]);
    // p2 is variant-scoped -> only v3 included.
    expect(rows[1].variants.map((v) => v.included)).toEqual([true, false]);
  });
});

describe('BulkWizard — destinationResolvesCategoryAtSubmit (#2211)', () => {
  const VALID_EAN = '5901234123457';

  beforeEach(() => {
    resolveStub.received = [];
    resolveStub.outcomes = [];
    resolveStub.completion = { catalogueLookupPerformed: true };
  });
  afterEach(cleanup);

  /**
   * `platformType` is deliberately one no in-tree plugin registers: the wizard's
   * derivation is capability-driven, and an unregistered platform contributes no
   * `bulkOfferConfigSection` (so Proceed is gated only by the shared slice) and
   * no `offerValidation` (so no platform blocker can be mistaken for the
   * category one these tests are about).
   */
  function connection(capabilities: string[]): Connection {
    return {
      id: 'conn-1',
      name: 'Test destination',
      status: 'active',
      platformType: 'testmarket',
      supportedCapabilities: ['OfferManager', 'OfferCreator', ...capabilities],
      config: { masterCatalogConnectionId: 'conn-master' },
    } as unknown as Connection;
  }

  function products(): Product[] {
    return [
      {
        id: 'prod_1',
        name: 'Test product',
        sku: 'prod_1',
        currency: 'PLN',
        variants: [
          {
            id: 'ol_variant_1',
            productId: 'prod_1',
            sku: 'v1',
            attributes: { Rozmiar: 'M' },
            ean: VALID_EAN,
            gtin: null,
            price: 39,
          } as unknown as ProductVariant,
        ],
      } as unknown as Product,
    ];
  }

  /**
   * The one outcome shape that matters here: master values complete (so price /
   * stock never blocks) and no category resolved, which is what makes the
   * category blocker the ONLY thing separating a ready row from a blocked one.
   */
  function unresolvedCategoryOutcome(): BulkResolveOutcome {
    return {
      productId: 'prod_1',
      variants: [
        {
          variantId: 'ol_variant_1',
          blockers: ['no-match'],
          resolvedCategoryId: null,
          resolvedProductCardId: null,
          resolutionMethod: null,
          masterPrice: 39,
          masterStock: 5,
          masterCurrency: 'PLN',
          categoryCandidates: [],
          ean: VALID_EAN,
        },
      ],
    };
  }

  async function renderAndResolve(capabilities: string[]): Promise<void> {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([connection(capabilities)]) },
      listings: {
        checkPublishedVariants: vi.fn().mockResolvedValue({ publishedVariantIds: [] }),
      },
    });

    renderWithProviders(
      <BulkWizard
        products={products()}
        resolveConnectionName={() => 'Test destination'}
        preselectedConnectionId="conn-1"
      />,
      { apiClient },
    );

    const proceed = await screen.findByRole('button', { name: /Proceed/ }, { timeout: 5000 });
    await waitFor(() => expect(proceed).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(proceed);

    fireEvent.click(await screen.findByRole('button', { name: 'finish resolve' }));
  }

  it('suppresses the category blocker when the manifest says the destination resolves it at submit', async () => {
    // No `EanCategoryMatcher` and no category browsing => the destination has no
    // pre-flight match to fail, so a `no-match` says nothing about the row.
    // A lookup that DID happen must not re-block it either.
    resolveStub.outcomes = [unresolvedCategoryOutcome()];
    resolveStub.completion = { catalogueLookupPerformed: true };

    await renderAndResolve([]);

    // The manifest half is what the Resolve step itself is handed.
    expect(resolveStub.received).toContain(true);
    expect(await screen.findByText('All included variants are ready.')).toBeInTheDocument();
    const cta = await screen.findAllByRole('button', { name: 'Create offers (1)' });
    expect(cta[0]).toBeEnabled();
  }, 15000);

  it('suppresses the category blocker when the stream reports no catalogue was consulted', async () => {
    // The manifest advertises a matcher, so it alone would block the row - but
    // the run looked nothing up (a destination that BORROWS a matcher advertises
    // none of its own, #1045), so every `no-match` in it is uninformative.
    resolveStub.outcomes = [unresolvedCategoryOutcome()];
    resolveStub.completion = { catalogueLookupPerformed: false };

    await renderAndResolve(['EanCategoryMatcher']);

    // The manifest reading held while the step ran; only its report flips it.
    expect(resolveStub.received).toContain(false);
    expect(await screen.findByText('All included variants are ready.')).toBeInTheDocument();
  }, 15000);

  it('keeps the category blocker when a catalogue lookup did run and matched nothing', async () => {
    resolveStub.outcomes = [unresolvedCategoryOutcome()];
    resolveStub.completion = { catalogueLookupPerformed: true };

    await renderAndResolve(['EanCategoryMatcher']);

    expect(await screen.findByText('1 variant needs attention.')).toBeInTheDocument();
    const cta = await screen.findAllByRole('button', { name: 'Create offers (0)' });
    expect(cta[0]).toBeDisabled();
  }, 15000);
});
