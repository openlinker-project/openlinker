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
  DuplicatePositionGroup,
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
    latchedAt: null,
    ...overrides,
  };
}

function buildGroup(overrides: Partial<DuplicatePositionGroup> = {}): DuplicatePositionGroup {
  return {
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

  it('should retry BOTH reads when Retry is clicked', async () => {
    const getDuplicatePositions = vi.fn().mockRejectedValue(new Error('Network error'));
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue(buildProvenanceStatus());
    const apiClient = createMockApiClient({
      inventory: { getDuplicatePositions, getProvenanceBackfillStatus },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    const retryButton = await screen.findByRole('button', { name: 'Retry' });
    expect(getDuplicatePositions).toHaveBeenCalledTimes(1);
    expect(getProvenanceBackfillStatus).toHaveBeenCalledTimes(1);

    await userEvent.click(retryButton);

    // `retry` refetches both queries — a regression that only refetches the
    // failing one would leave the provenance read permanently stale with no
    // signal (#3262 review).
    expect(getDuplicatePositions).toHaveBeenCalledTimes(2);
    expect(getProvenanceBackfillStatus).toHaveBeenCalledTimes(2);
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
    expect(screen.queryByText('Not ready')).not.toBeInTheDocument();
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
              buildGroup({
                productName: 'Wireless Mouse',
                sku: 'WM-100',
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
              }),
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
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
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
            groups: [buildGroup({ rowCount: 1, liveRowCount: 1 })],
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

  it('should render the Stuck badge and re-arm copy when the backfill has latched with rows remaining', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(buildReport()),
        getProvenanceBackfillStatus: vi.fn().mockResolvedValue(
          buildProvenanceStatus({
            remainingNull: 3,
            completed: false,
            latchedAt: '2026-08-01T00:00:00.000Z',
          })
        ),
      },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // `latchedAt` set + rows still remaining is the one state that must read
    // as "nothing is draining this, intervene" rather than "wait, it's
    // working" — collapsing it into the ordinary Pending badge would tell an
    // operator to wait on a number that will never move on its own (#3262
    // review).
    expect(await screen.findByText('Stuck')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(
      screen.getByText(/has stopped running\. It will not resume on its own — ask an engineer/)
    ).toBeInTheDocument();
  });

  it('should keep showing the last successful scan, with an inline banner, when a Refresh fails', async () => {
    const getDuplicatePositions = vi
      .fn()
      .mockResolvedValueOnce(buildReport())
      .mockRejectedValueOnce(new Error('Refresh network error'));
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue(buildProvenanceStatus());
    const apiClient = createMockApiClient({
      inventory: { getDuplicatePositions, getProvenanceBackfillStatus },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    // The initial load succeeds and renders the report...
    expect(await screen.findByText('Ready')).toBeInTheDocument();

    const refreshButton = screen.getByRole('button', { name: 'Refresh' });
    await userEvent.click(refreshButton);

    // ...and a failed *refresh* must not blank the screen: the last-good
    // report stays on screen alongside an inline failure banner, rather than
    // falling through to the full-page ErrorState the initial-load failure
    // uses (#3262 review — `initialLoadError` vs `refreshError` is otherwise
    // an untested distinction).
    expect(await screen.findByText('Refresh failed')).toBeInTheDocument();
    expect(
      screen.getByText(/Refresh network error — showing the last successful scan below\./)
    ).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText('Unable to load the duplicate-position report')).not.toBeInTheDocument();
  });

  it('should expand and collapse a group row to reveal/hide its individual inventory_items rows', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 1,
            rowCount: 2,
            excessRowCount: 1,
            groups: [
              buildGroup({
                liveRowCount: 1,
                productName: 'Wireless Mouse',
                sku: 'WM-100',
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
              }),
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

    // Nothing from the detail drawer is on screen before the toggle is
    // clicked — otherwise a regression that always renders the detail (or
    // defaults to expanded) would pass every assertion below unchallenged
    // (#3262 review).
    const toggle = await screen.findByRole('button', { name: /expand rows for product/i });
    expect(screen.queryByText('ol_inventory_row1')).not.toBeInTheDocument();
    expect(screen.queryByText('ol_inventory_row2')).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByText('ol_inventory_row1')).toBeInTheDocument();
    expect(screen.getByText('ol_inventory_row2')).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();

    const collapseToggle = screen.getByRole('button', { name: /collapse rows for product/i });
    await userEvent.click(collapseToggle);

    expect(screen.queryByText('ol_inventory_row1')).not.toBeInTheDocument();
    expect(screen.queryByText('ol_inventory_row2')).not.toBeInTheDocument();
  });

  it('should show the truncated-report banner with both counts when the response is capped', async () => {
    const apiClient = createMockApiClient({
      inventory: {
        getDuplicatePositions: vi.fn().mockResolvedValue(
          buildReport({
            groupCount: 5,
            rowCount: 12,
            excessRowCount: 7,
            truncated: true,
            groups: [buildGroup()],
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
    // The number an operator acts on — how much was withheld — not just the
    // banner's title (#3262 review): 1 group shown (`groups.length`) of 5
    // total (`groupCount`).
    expect(screen.getByText(/largest 1 of 5 duplicate groups/)).toBeInTheDocument();
  });

  it('should not show the truncated-report banner when the response is not capped', async () => {
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

    await screen.findByText('Ready');
    expect(screen.queryByText('Detail truncated')).not.toBeInTheDocument();
  });

  it('should deny a non-admin session without ever calling getDuplicatePositions', async () => {
    const getDuplicatePositions = vi.fn().mockResolvedValue(buildReport());
    const getProvenanceBackfillStatus = vi.fn().mockResolvedValue(buildProvenanceStatus());
    const apiClient = createMockApiClient({
      inventory: { getDuplicatePositions, getProvenanceBackfillStatus },
    });

    renderWithProviders(<DuplicatePositionsPage />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'user_1',
        username: 'operator',
        email: 'operator@example.com',
        role: 'operator',
        permissions: [],
        analyticsConsent: true,
      }),
    });

    // The page's own access-denied branch (`@Roles('admin')` on the backing
    // endpoints) — this diagnostic reads `inventory_items` directly, so a
    // non-admin must never reach the actual reads (#3262 review, and the
    // duplicate-gate problem #3261 fixed).
    expect(await screen.findByText('Admin role required')).toBeInTheDocument();
    expect(getDuplicatePositions).not.toHaveBeenCalled();
    expect(getProvenanceBackfillStatus).not.toHaveBeenCalled();
  });
});
