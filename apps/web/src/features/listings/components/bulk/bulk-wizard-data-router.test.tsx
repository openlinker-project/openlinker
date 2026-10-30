/**
 * BulkWizard leave guard through a real data router (#3851)
 *
 * The shared `renderWithProviders` wraps everything in a `MemoryRouter`, where
 * `useBlocker` is unavailable and only the `beforeunload` half of the guard
 * exists. These cases mount the real wizard under `createMemoryRouter` so the
 * in-app half is live, and pin the two ends that matter: an edited batch asks
 * before the operator navigates away, and a submitted one does not ask before
 * the wizard's own navigation to the batch page.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Link, RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ApiClientProvider } from '../../../../app/api/api-client-provider';
import { plugins as inTreePlugins } from '../../../../plugins';
import { createNoopSessionAdapter } from '../../../../shared/auth/noop-session-adapter';
import { SessionProvider } from '../../../../shared/auth/session-provider';
import { LocaleProvider } from '../../../../shared/i18n';
import { PluginRegistryProvider } from '../../../../shared/plugins';
import { ToastProvider } from '../../../../shared/ui/toast-provider';
import { TooltipProvider } from '../../../../shared/ui/tooltip';
import { createMockApiClient } from '../../../../test/test-utils';
import type { Connection } from '../../../connections';
import type { Product, ProductVariant } from '../../../products';
import type { BulkOfferCreateResponse } from '../../api/bulk-listings.types';
import { BulkWizard } from './bulk-wizard';
import type { BulkResolveCompletion, BulkResolveOutcome } from './bulk-resolve-step';

vi.mock('../../../demo', () => ({ captureDemoEvent: vi.fn() }));

const VALID_EAN = '5901234123457';

const resolved: BulkResolveOutcome = {
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

vi.mock('./bulk-resolve-step', () => ({
  BulkResolveStep: (props: {
    onComplete: (outcomes: BulkResolveOutcome[], completion: BulkResolveCompletion) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        props.onComplete([resolved], { catalogueLookupPerformed: true });
      }}
    >
      finish resolve
    </button>
  ),
}));

afterEach(cleanup);

const DIALOG = { name: 'Leave this batch?' };

async function renderWizardInDataRouter(): Promise<void> {
  const bulkCreate = vi.fn().mockResolvedValue({
    batchId: 'batch-1',
    jobIds: ['job-1'],
    skippedAlreadyListedCount: 0,
    skippedAvailabilityUnknownCount: 0,
    skippedInvalidEanCount: 0,
  } satisfies BulkOfferCreateResponse);
  const apiClient = createMockApiClient({
    connections: {
      list: vi.fn().mockResolvedValue([
        {
          id: 'conn-1',
          name: 'Test destination',
          status: 'active',
          platformType: 'testmarket',
          supportedCapabilities: ['OfferManager', 'OfferCreator'],
          config: { masterCatalogConnectionId: 'conn-master' },
        } as unknown as Connection,
      ]),
    },
    listings: {
      checkPublishedVariants: vi.fn().mockResolvedValue({ publishedVariantIds: [] }),
      bulkCreate,
    },
  });
  const products = [
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
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/wizard',
        element: (
          <>
            <Link to="/elsewhere">Go elsewhere</Link>
            <BulkWizard
              products={products}
              resolveConnectionName={() => 'Test destination'}
              preselectedConnectionId="conn-1"
            />
          </>
        ),
      },
      { path: '/elsewhere', element: <h1>Elsewhere</h1> },
      { path: '/listings/bulk-batches/:batchId', element: <h1>Batch page</h1> },
    ],
    { initialEntries: ['/wizard'] }
  );
  render(
    <LocaleProvider>
      <PluginRegistryProvider plugins={inTreePlugins}>
        <SessionProvider adapter={createNoopSessionAdapter()}>
          <ToastProvider>
            <TooltipProvider>
              <ApiClientProvider client={apiClient}>
                <QueryClientProvider client={queryClient}>
                  <RouterProvider router={router} />
                </QueryClientProvider>
              </ApiClientProvider>
            </TooltipProvider>
          </ToastProvider>
        </SessionProvider>
      </PluginRegistryProvider>
    </LocaleProvider>
  );

  const proceed = await screen.findByRole('button', { name: /Proceed/ }, { timeout: 5000 });
  await waitFor(() => expect(proceed).toBeEnabled(), { timeout: 5000 });
  fireEvent.click(proceed);
  fireEvent.click(await screen.findByRole('button', { name: 'finish resolve' }));
}

async function editBatch(): Promise<void> {
  const include = await screen.findByRole('checkbox', { name: /^Include all .* variants$/ });
  fireEvent.click(include);
  fireEvent.click(include);
}

describe('BulkWizard leave guard in a data router (#3851)', () => {
  it('should ask before leaving when the batch was edited and not submitted', async () => {
    await renderWizardInDataRouter();
    await editBatch();

    fireEvent.click(screen.getByRole('link', { name: 'Go elsewhere' }));

    expect(await screen.findByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Elsewhere' })).not.toBeInTheDocument();
  }, 15000);

  it('should navigate to the batch page without asking after a successful submit', async () => {
    await renderWizardInDataRouter();
    await editBatch();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Create offers (1)' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create offers' }));

    expect(await screen.findByRole('heading', { name: 'Batch page' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
  }, 15000);
});
