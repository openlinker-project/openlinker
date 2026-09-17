import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderWithProviders,
  createMockApiClient,
  createAuthenticatedSessionAdapter,
} from '../../test/test-utils';
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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(screen.getByText('Loading duplicate-position report')).toBeInTheDocument();
  });

  it('should show an error state with retry when the report fails to load', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockRejectedValue(new Error('Network error')),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(buildProvenanceStatus()),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('ol_product_a1')).toBeInTheDocument();
  });

  it('should render a not-ready banner when the provenance backfill is still running, even with zero duplicate groups', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi
          .fn()
          .mockResolvedValue(buildProvenanceStatus({ remainingNull: 42, completed: false })),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Not ready')).toBeInTheDocument();
    expect(screen.getByText('42 row(s) still missing provenance')).toBeInTheDocument();
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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

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

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Detail truncated')).toBeInTheDocument();
  });
});
