import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { DuplicatePositionsPage } from './duplicate-positions-page';
import type {
  DuplicatePositionsReport,
  ProvenanceBackfillStatus,
} from '../../features/inventory/api/inventory.types';

function buildReport(overrides: Partial<DuplicatePositionsReport> = {}): DuplicatePositionsReport {
  return {
    groupCount: 0,
    rowCount: 0,
    excessRowCount: 0,
    groups: [],
    truncated: false,
    generatedAt: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function buildProvenanceStatus(
  overrides: Partial<ProvenanceBackfillStatus> = {}
): ProvenanceBackfillStatus {
  return {
    remainingNull: 0,
    completed: true,
    ...overrides,
  };
}

describe('DuplicatePositionsPage', () => {
  it('should show loading state while the report is fetching', () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockReturnValue(new Promise(() => {})),
        getProvenanceBackfillStatus: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(screen.getByText('Loading duplicate-position report')).toBeInTheDocument();
  });

  it('should show an error state with retry when the report fails to load', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockRejectedValue(new Error('Network error')),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(
      await screen.findByText('Unable to load the duplicate-position report')
    ).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show an error state when the provenance-backfill-status read fails', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi.fn().mockRejectedValue(new Error('Forbidden')),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(
      await screen.findByText('Unable to load the duplicate-position report')
    ).toBeInTheDocument();
    expect(screen.getByText('Forbidden')).toBeInTheDocument();
  });

  it('should render a ready banner and success KPI tone when both readiness conditions hold', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('No duplicate position groups')).toBeInTheDocument();
    expect(screen.getByText('Provenance backfill complete')).toBeInTheDocument();
    expect(screen.getByText('No duplicate positions')).toBeInTheDocument();
  });

  it('should render a not-ready banner when duplicate groups exist, with product name and sku shown', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 2,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row1',
                    availableQuantity: 5,
                    reservedQuantity: 1,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row2',
                    availableQuantity: 3,
                    reservedQuantity: 0,
                    isStale: true,
                    updatedAt: '2026-09-13T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText('Not ready')).toBeInTheDocument();
    expect(screen.getByText('Duplicate groups')).toBeInTheDocument();
    expect(screen.getByText('Wireless Mouse')).toBeInTheDocument();
    expect(screen.getByText('WM-100')).toBeInTheDocument();
  });

  it('should fall back to the raw id when a group product could not be resolved', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 1,
            excessRowCount: 0,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 1,
                liveRowCount: 1,
                productName: null,
                sku: null,
                connectionName: null,
                locationName: null,
                rows: [],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText('ol_product_a1')).toBeInTheDocument();
  });

  it('should render a not-ready banner when the provenance backfill is still running, even with zero duplicate groups', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(
          buildProvenanceStatus({ remainingNull: 42, completed: false })
        ),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText('Not ready')).toBeInTheDocument();
    expect(
      screen.getByText('Provenance backfill still running (42 row(s) remaining)')
    ).toBeInTheDocument();
    // The other condition is still independently reported as done.
    expect(screen.getByText('No duplicate position groups')).toBeInTheDocument();
  });

  it('should expand a group row to reveal its individual inventory_items rows', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 1,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row1',
                    availableQuantity: 5,
                    reservedQuantity: 1,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row2',
                    availableQuantity: 3,
                    reservedQuantity: 0,
                    isStale: true,
                    updatedAt: '2026-09-13T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const toggle = await screen.findByRole('button', { name: /expand rows for product/i });
    await userEvent.click(toggle);

    expect(screen.getByText('ol_inventory_row1')).toBeInTheDocument();
    expect(screen.getByText('ol_inventory_row2')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('should show the truncated-report banner when the response is capped', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 5,
            rowCount: 12,
            excessRowCount: 7,
            truncated: true,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 2,
                productName: null,
                sku: null,
                connectionName: null,
                locationName: null,
                rows: [],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText('Detail truncated')).toBeInTheDocument();
  });

  it('should show the generatedAt timestamp and the re-run-before-acting caution text', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({ generatedAt: '2026-09-15T10:30:00.000Z' })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(await screen.findByText(/Generated/)).toBeInTheDocument();
    expect(
      screen.getByText(/re-run the report immediately before acting on it/)
    ).toBeInTheDocument();
  });

  it('should render Export CSV disabled until the report loads, and Refresh always available', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await screen.findByText('No duplicate positions'); // report has settled
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('should trigger a CSV download when Export CSV is clicked', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 1,
            excessRowCount: 0,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 1,
                liveRowCount: 1,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row1',
                    availableQuantity: 5,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const exportButton = await screen.findByRole('button', { name: 'Export CSV' });
    await userEvent.click(exportButton);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('should render the Live qty at risk column as the sum of live (non-stale) rows only', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 2,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row1',
                    availableQuantity: 14,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row2',
                    availableQuantity: 9,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-13T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row3',
                    availableQuantity: 100,
                    reservedQuantity: 0,
                    isStale: true,
                    updatedAt: '2026-06-01T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    // 14 + 9 live, the stale row's 100 excluded — never 123.
    expect(await screen.findByText('23')).toBeInTheDocument();
  });

  it('should warn about reservation risk for a non-survivor row holding a reservation', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 2,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row_newest',
                    availableQuantity: 5,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row_reserved',
                    availableQuantity: 3,
                    reservedQuantity: 2,
                    isStale: false,
                    updatedAt: '2026-09-13T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const toggle = await screen.findByRole('button', { name: /expand rows for product/i });
    await userEvent.click(toggle);

    expect(
      screen.getByText(/Reservation risk — do not blindly follow the survivor badge/)
    ).toBeInTheDocument();
    // The badge's icon is wrapped in its own aria-hidden span (a11y — the
    // glyph must not be read aloud literally by a screen reader), so the
    // full label is split across elements and needs a text-content matcher
    // rather than an exact string match.
    expect(
      screen.getByText((_, element) => element?.textContent?.trim() === '✓ likely survivor')
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent?.trim() === '⛔ reserved')
    ).toBeInTheDocument();
  });

  it('should open the remediation modal generically from the not-ready banner', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 1,
            excessRowCount: 0,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: null,
                locationId: null,
                sourceConnectionId: null,
                rowCount: 1,
                liveRowCount: 1,
                productName: null,
                sku: null,
                connectionName: null,
                locationName: null,
                rows: [],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const links = await screen.findAllByRole('button', {
      name: /Remediation guide: how to pick the survivor/,
    });
    await userEvent.click(links[0]);

    expect(await screen.findByText('Remediation guide (condensed)')).toBeInTheDocument();
    expect(
      screen.getByText(/Open this from a specific group.s row instead/)
    ).toBeInTheDocument();
  });

  it('should open the remediation modal from a group row with a generated DELETE statement', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              {
                productId: 'ol_product_a1',
                productVariantId: 'ol_variant_1',
                locationId: null,
                sourceConnectionId: null,
                rowCount: 2,
                liveRowCount: 2,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
                connectionName: null,
                locationName: null,
                rows: [
                  {
                    id: 'ol_inventory_row_survivor',
                    availableQuantity: 5,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-14T00:00:00.000Z',
                  },
                  {
                    id: 'ol_inventory_row_loser',
                    availableQuantity: 3,
                    reservedQuantity: 0,
                    isStale: false,
                    updatedAt: '2026-09-13T00:00:00.000Z',
                  },
                ],
              },
            ],
          })
        ),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const toggle = await screen.findByRole('button', { name: /expand rows for product/i });
    await userEvent.click(toggle);

    const remediationLinks = await screen.findAllByRole('button', {
      name: 'Remediation guide: how to pick the survivor and delete the rest →',
    });
    // The banner's generic link plus this group's own — the group-specific
    // one is the one rendered inside the just-expanded detail panel.
    await userEvent.click(remediationLinks[remediationLinks.length - 1]);

    expect(await screen.findByText('Remediation guide (condensed)')).toBeInTheDocument();
    const sqlBox = screen.getByDisplayValue(/DELETE FROM "inventory_items"/);
    expect((sqlBox as HTMLTextAreaElement).value).toContain("'ol_inventory_row_loser'");
    expect((sqlBox as HTMLTextAreaElement).value).not.toContain("'ol_inventory_row_survivor'");
  });

  it('should update maxGroups and re-request the report when Apply is clicked in the truncated state', async () => {
    const getDuplicatePositions = vi.fn().mockResolvedValue(
      buildReport({
        groupCount: 5,
        rowCount: 12,
        excessRowCount: 7,
        truncated: true,
        groups: [],
      })
    );
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions,
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, { apiClient });

    const maxGroupsInput = await screen.findByLabelText('maxGroups');
    await userEvent.clear(maxGroupsInput);
    await userEvent.type(maxGroupsInput, '250');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(maxGroupsInput).toHaveValue(250);
    await waitFor(() => {
      expect(getDuplicatePositions).toHaveBeenLastCalledWith(250);
    });
  });
});
