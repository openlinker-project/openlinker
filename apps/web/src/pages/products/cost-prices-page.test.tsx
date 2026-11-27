import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CostPricesPage, parseCostInput } from './cost-prices-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../test/test-utils';
import { costCoverage, costSummary, worklistRow } from '../../test/cost-test-fixtures';
import type { CostWorklistRow } from '../../features/products/api/products.types';

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

const ROWS: CostWorklistRow[] = [
  worklistRow({ variantId: 'v1', sku: 'FIL-90-CZA' }),
  worklistRow({ variantId: 'v2', sku: 'KUB-350-SZA', productName: 'Kubek 350 ml', netSales30d: 1544.7 }),
  worklistRow({ variantId: 'v3', sku: 'FIL-90-BIA', netSales30d: 1378.6 }),
];

interface Options {
  adapter?: typeof adminAdapter;
  rows?: CostWorklistRow[];
  coverage?: Partial<ReturnType<typeof costCoverage>>;
  trackMargin?: boolean;
  setVariantCost?: Mock;
  bulkFillVariantCost?: Mock;
  route?: string;
}

function renderPage(options: Options = {}): { setVariantCost: Mock; bulk: Mock; getWorklist: Mock } {
  const setVariantCost = options.setVariantCost ?? vi.fn().mockResolvedValue({});
  const bulk =
    options.bulkFillVariantCost ??
    vi.fn().mockResolvedValue({ filled: ['v1', 'v3'], skippedAlreadySet: [], notFound: [] });
  const getWorklist = vi.fn().mockResolvedValue({
    currency: 'PLN',
    items: options.rows ?? ROWS,
    limit: 20,
    offset: 0,
  });
  renderWithProviders(<CostPricesPage />, {
    route: options.route ?? '/products/cost-prices',
    sessionAdapter: options.adapter ?? adminAdapter,
    apiClient: createMockApiClient({
      products: {
        getCostCoverage: vi.fn().mockResolvedValue(costCoverage(options.coverage)),
        getCostSummary: vi.fn().mockResolvedValue(costSummary()),
        getCostWorklist: getWorklist,
        countCostWorklist: vi.fn().mockResolvedValue({ total: 3 }),
        setVariantCost: setVariantCost as never,
        bulkFillVariantCost: bulk as never,
      },
      analyticsSettings: {
        getSettings: vi.fn().mockResolvedValue({
          displayCurrency: 'PLN',
          displayCurrencySource: 'default',
          rateBasis: 'current',
          includeBackfilledTaxRatesInNetSales: false,
          netGrossBasis: 'gross',
          trackMargin: options.trackMargin ?? true,
          updatedAt: null,
          updatedByUserId: null,
        }),
      },
      system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    }),
  });
  return { setVariantCost, bulk, getWorklist };
}

describe('parseCostInput', () => {
  it('should accept zero and two decimals, with a comma or a dot', () => {
    expect(parseCostInput('0')).toBe('0');
    expect(parseCostInput('11,4')).toBe('11.4');
    expect(parseCostInput(' 19.60 ')).toBe('19.60');
  });
  it('should reject negatives, three decimals and text', () => {
    expect(parseCostInput('-1')).toBeNull();
    expect(parseCostInput('1.234')).toBeNull();
    expect(parseCostInput('abc')).toBeNull();
    expect(parseCostInput('')).toBeNull();
  });
});

describe('CostPricesPage', () => {
  it('should show the three tabs with counts from coverage and summary', async () => {
    renderPage();
    const sold = await screen.findByTestId('cost-worklist-tab-sold');
    expect(sold).toHaveTextContent('9');
    expect(screen.getByTestId('cost-worklist-tab-all')).toHaveTextContent('146');
    expect(screen.getByTestId('cost-worklist-tab-has-cost')).toHaveTextContent('266');
    expect(screen.getByTestId('cost-kpi-expected')).toHaveTextContent('88.4%');
  });

  it('should request the tab from the URL', async () => {
    const { getWorklist } = renderPage({ route: '/products/cost-prices?tab=all' });
    await screen.findByTestId('cost-worklist-table');
    expect(getWorklist).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'all' }),
      expect.objectContaining({ limit: 20, offset: 0 })
    );
  });

  it('should save a cost inline and keep the row as saved', async () => {
    const { setVariantCost } = renderPage();
    await userEvent.click(await screen.findByTestId('cost-worklist-add-fil-90-cza'));
    await userEvent.type(screen.getByTestId('cost-worklist-input-fil-90-cza'), '11.40');
    await userEvent.click(screen.getByTestId('cost-worklist-save-fil-90-cza'));
    await waitFor(() => {
      expect(setVariantCost).toHaveBeenCalledWith('v1', { netUnitCost: '11.40', currency: 'PLN' });
    });
    expect(await screen.findByTestId('cost-worklist-saved-fil-90-cza')).toHaveTextContent(
      'PLN 11.40 net · saved, counts from the next order'
    );
  });

  it('should move focus to the next row Add cost when Enter saves a row', async () => {
    renderPage();
    await userEvent.click(await screen.findByTestId('cost-worklist-add-fil-90-cza'));
    await userEvent.type(screen.getByTestId('cost-worklist-input-fil-90-cza'), '11.40{Enter}');
    await waitFor(() => {
      expect(screen.getByTestId('cost-worklist-add-kub-350-sza')).toHaveFocus();
    });
  });

  it('should refuse an invalid amount without calling the API', async () => {
    const { setVariantCost } = renderPage();
    await userEvent.click(await screen.findByTestId('cost-worklist-add-fil-90-cza'));
    await userEvent.type(screen.getByTestId('cost-worklist-input-fil-90-cza'), 'abc{Enter}');
    expect(await screen.findByText('Enter 0 or more, with up to 2 decimals.')).toBeInTheDocument();
    expect(setVariantCost).not.toHaveBeenCalled();
  });

  it('should open the bulk dialog for the selection and send one request with a toast', async () => {
    const { bulk } = renderPage();
    await userEvent.click(await screen.findByTestId('cost-worklist-select-fil-90-cza'));
    await userEvent.click(screen.getByTestId('cost-worklist-select-fil-90-bia'));
    await userEvent.click(screen.getByTestId('cost-worklist-bulk-open'));

    const dialog = await screen.findByTestId('cost-bulk-dialog');
    expect(within(dialog).getByText('Set one cost for 2 variants')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByTestId('cost-bulk-input'), '11.40');
    expect(within(dialog).getByTestId('cost-bulk-preview')).toHaveTextContent('PLN 11.40');
    await userEvent.click(within(dialog).getByTestId('cost-bulk-save'));

    await waitFor(() => {
      expect(bulk).toHaveBeenCalledWith({
        variantIds: ['v1', 'v3'],
        netUnitCost: '11.40',
        currency: 'PLN',
      });
    });
    expect(await findToastTitle('Cost saved for 2 variants')).toBeInTheDocument();
    expect(await screen.findByTestId('cost-worklist-saved-fil-90-cza')).toBeInTheDocument();
  });

  it('should show a skipped count in the toast when some variants already had a cost', async () => {
    renderPage({
      bulkFillVariantCost: vi
        .fn()
        .mockResolvedValue({ filled: ['v1'], skippedAlreadySet: ['v3'], notFound: [] }),
    });
    await userEvent.click(await screen.findByTestId('cost-worklist-select-fil-90-cza'));
    await userEvent.click(screen.getByTestId('cost-worklist-select-fil-90-bia'));
    await userEvent.click(screen.getByTestId('cost-worklist-bulk-open'));
    await userEvent.type(await screen.findByTestId('cost-bulk-input'), '5');
    await userEvent.click(screen.getByTestId('cost-bulk-save'));
    expect(await screen.findByText('1 already had a cost and was left as it was.')).toBeInTheDocument();
  });

  it('should show the done state when every sold variant has a cost', async () => {
    renderPage({ rows: [], coverage: { soldVariantsWithoutCost: 0 } });
    expect(await screen.findByTestId('cost-worklist-done-empty')).toHaveTextContent(
      'Every variant you sold has a cost'
    );
  });

  it('should be read only for a session without products:write', async () => {
    renderPage({ adapter: viewerAdapter });
    expect(await screen.findByTestId('cost-worklist-readonly')).toHaveTextContent(
      'You can see cost prices but not change them'
    );
    await screen.findByTestId('cost-worklist-table');
    expect(screen.queryByTestId('cost-worklist-select-fil-90-cza')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cost-worklist-add-fil-90-cza')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cost-worklist-bulk-open')).not.toBeInTheDocument();
    expect(screen.getByTestId('cost-worklist-cost-fil-90-cza')).toHaveTextContent('Not recorded');
  });

  it('should note that margin tracking is off and stay usable', async () => {
    renderPage({ trackMargin: false });
    expect(await screen.findByTestId('cost-tracking-off-note')).toBeInTheDocument();
    expect(await screen.findByTestId('cost-worklist-table')).toBeInTheDocument();
  });
});
