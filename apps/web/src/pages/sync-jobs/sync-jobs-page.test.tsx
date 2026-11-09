import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { SyncJobsPage } from './sync-jobs-page';
import type {
  PaginatedSyncJobs,
  SyncJobFilters,
  SyncJobPagination,
  JobType,
} from '../../features/sync-jobs/api/sync-jobs.types';
import { SYNC_JOBS_MAX_LIMIT } from '../../features/sync-jobs/api/sync-jobs.types';
import type { Connection } from '../../features/connections/api/connections.types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_allegro_1',
    name: 'Allegro Europe',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const sampleJobs: PaginatedSyncJobs = {
  items: [
    {
      id: 'job_abc12345-1111-2222-3333-444444444444',
      jobType: 'marketplace.orders.poll',
      connectionId: 'conn_allegro_1',
      status: 'succeeded',
      outcome: 'ok',
      attempts: 1,
      maxAttempts: 3,
      nextRunAt: '2026-01-15T10:05:00.000Z',
      lastError: null,
      payloadJson: null,
      idempotencyKey: null,
      lockedAt: null,
      lockedBy: null,
      lastAttemptDurationMs: null,
      deferredTotalMs: null,
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-01-15T10:01:00.000Z',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

describe('SyncJobsPage', () => {
  afterEach(cleanup);
  it('should show loading state initially', () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    // The poison-entries section below the jobs list has its own loading
    // region, so the jobs list's one is picked out by its label.
    const jobsLoading = screen.getByText('Loading sync jobs…').closest('[role="status"]');
    expect(jobsLoading).toBeInTheDocument();
  });

  it('should announce each list by name when the jobs and poison entries are both loading', () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
      streamDeadLetters: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
        count: vi.fn().mockReturnValue(new Promise(() => {})),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    const announcements = screen.getAllByRole('status').map((region) => region.textContent);
    expect(announcements).toEqual(['Loading sync jobs…', 'Loading poison stream entries…']);
  });

  it('should show jobs table when data loads', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText(/1 \/ 3/)).toBeInTheDocument();
    expect(screen.getAllByText('Fetch new orders').length).toBeGreaterThan(1);
  });

  it('renders the Diagnostics eyebrow so the header matches the sidebar group and breadcrumb', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Diagnostics')).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockRejectedValue(new Error('Service unavailable')) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('Unable to load sync jobs')).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
  });

  it('should show empty state without an action when no jobs exist and no filter is active', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByText('No jobs found')).toBeInTheDocument();
    // Jobs are system-populated — no CTA for the no-filter branch.
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /manage connections|browse|add the first/i }),
    ).not.toBeInTheDocument();
  });

  it('should show a Clear filters button that clears all filter params when filters are active', async () => {
    const user = userEvent.setup();
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, {
      apiClient: mockApi,
      route: '/sync-jobs?status=failed&jobType=order.sync',
    });

    expect(await screen.findByText('No jobs match the current filters.')).toBeInTheDocument();
    // One Clear filters control on screen, in the filter bar - not a second
    // copy in the empty state (#4016).
    expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    // After clearing, we're back to the informational empty state — no button.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });
    expect(screen.getByText('No sync jobs have been enqueued yet.')).toBeInTheDocument();
  });

  // Regression guard for #270: the backend rejects `limit > 100` with HTTP 400
  // ("limit must not be greater than 100"). The page previously requested 200
  // and broke every load.
  it('requests sync jobs with limit capped at SYNC_JOBS_MAX_LIMIT', async () => {
    const listMock = vi.fn().mockResolvedValue(sampleJobs);
    const mockApi = createMockApiClient({
      syncJobs: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalled();
    });
    const [, pagination] = listMock.mock.calls[0] as [SyncJobFilters, SyncJobPagination];
    expect(pagination.limit).toBeLessThanOrEqual(SYNC_JOBS_MAX_LIMIT);
    expect(pagination.limit).toBe(SYNC_JOBS_MAX_LIMIT);
  });

  it('should render the connection as a ConnectionChip linking to the connection (#4016)', async () => {
    const connection = makeConnection();
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: {
        list: vi.fn().mockResolvedValue([connection]),
        getById: vi.fn().mockResolvedValue(connection),
      },
    });

    const { container } = renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await waitFor(() => {
      expect(container.querySelector('table .connection-chip')).not.toBeNull();
    });
    const chip = container.querySelector('table .connection-chip');
    expect(chip).toHaveTextContent('Allegro Europe');
    expect(chip?.closest('a') ?? chip).toHaveAttribute('href', '/connections/conn_allegro_1');
  });

  it('should label every filter with visible text (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    for (const name of ['Status', 'Job type', 'Outcome', 'Connection']) {
      expect(screen.getByLabelText(name, { selector: 'select' })).toBeInTheDocument();
    }
  });

  it('should lead with the job type name and keep the full code under it (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await screen.findByText(/1 \/ 3/);
    const cell = container.querySelector('table .sync-job-type');
    expect(cell).toHaveClass('sync-job-type--named');
    expect(cell?.querySelector('.sync-job-type__action')).toHaveTextContent('Fetch new orders');
    expect(cell?.querySelector('.sync-job-type__scope')).toHaveTextContent(
      'marketplace.orders.poll'
    );
    expect(cell).toHaveAttribute('title', 'marketplace.orders.poll');
  });

  it('should fall back to the code split when a job type has no name (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue({
          ...sampleJobs,
          items: [{ ...sampleJobs.items[0], jobType: 'future.unknown.thing' as JobType }],
        }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    const { container } = renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await screen.findByText(/1 \/ 3/);
    const cell = container.querySelector('table .sync-job-type');
    expect(cell).not.toHaveClass('sync-job-type--named');
    expect(cell?.querySelector('.sync-job-type__action')).toHaveTextContent('thing');
    expect(cell?.querySelector('.sync-job-type__scope')).toHaveTextContent('future.unknown');
  });

  it('should reveal the whole last error in place without opening the job (#4016)', async () => {
    const user = userEvent.setup();
    const longError = `removed with order ${'x'.repeat(200)} END-OF-ERROR`;
    // jsdom does no layout, so make the clamped error measure as overflowing:
    // the toggle is shown only when the text is actually clipped.
    const isErrorText = (el: HTMLElement): boolean =>
      el.classList.contains('sync-job-error__text');
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isErrorText(this) ? 120 : 0;
      });
    const clientSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return isErrorText(this) ? 36 : 0;
      });
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue({
          ...sampleJobs,
          items: [{ ...sampleJobs.items[0], status: 'dead', lastError: longError }],
        }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    const toggle = await screen.findByRole('button', { name: 'Show full error' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText(longError)).toHaveClass('sync-job-error__text--open');
    scrollSpy.mockRestore();
    clientSpy.mockRestore();
  });

  it('should not offer the toggle when the error fits (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: {
        list: vi.fn().mockResolvedValue({
          ...sampleJobs,
          items: [{ ...sampleJobs.items[0], status: 'dead', lastError: 'short error' }],
        }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findAllByText('short error')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Show full error' })).not.toBeInTheDocument();
  });

  it('should collapse the poison entries section to one line when there are none (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      streamDeadLetters: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
        count: vi.fn().mockResolvedValue({ count: 0 }),
      },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    expect(await screen.findByTestId('poison-entries-none')).toHaveTextContent('None recorded');
    expect(screen.queryByRole('table', { name: 'Poison stream entries' })).not.toBeInTheDocument();
    expect(screen.queryByText('No poison entries')).not.toBeInTheDocument();
  });

  it('should disable Previous and Next on a single page (#4016)', async () => {
    const mockApi = createMockApiClient({
      syncJobs: { list: vi.fn().mockResolvedValue(sampleJobs) },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await screen.findByText(/1 \/ 3/);
    const [previous] = screen.getAllByRole('button', { name: 'Previous' });
    const [next] = screen.getAllByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeDisabled();
    expect(previous).toHaveClass('button--secondary');
  });

  // #3507 G03-12: the type filter listed 21 of the core's job types, so an
  // `orders.export` run — which the export dialog links to — could be seen but
  // never filtered to. `scripts/check-job-type-mirror.mjs` guards the whole set.
  it('should offer orders.export in the job type filter and apply it when the URL carries it', async () => {
    const listMock = vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    const mockApi = createMockApiClient({
      syncJobs: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SyncJobsPage />, {
      apiClient: mockApi,
      route: '/sync-jobs?jobType=orders.export',
    });

    const typeFilter = await screen.findByRole('combobox', { name: /^job type$/i });
    expect(
      await screen.findByRole('option', { name: 'Export orders' }),
    ).toBeInTheDocument();
    expect(typeFilter).toHaveValue('orders.export');
    await waitFor(() => {
      const lastCall = listMock.mock.calls.at(-1) as [SyncJobFilters, SyncJobPagination];
      expect(lastCall[0].jobType).toBe('orders.export');
    });
  });

  it('filters sync jobs by the selected connection when changing the dropdown', async () => {
    const user = userEvent.setup();
    const connection = makeConnection();
    const listMock = vi.fn().mockResolvedValue(sampleJobs);
    const mockApi = createMockApiClient({
      syncJobs: { list: listMock },
      connections: { list: vi.fn().mockResolvedValue([connection]) },
    });

    renderWithProviders(<SyncJobsPage />, { apiClient: mockApi });

    await screen.findByRole('option', { name: 'Allegro Europe' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: /^connection$/i }),
      connection.id,
    );

    await waitFor(() => {
      const lastCall = listMock.mock.calls.at(-1) as [SyncJobFilters, SyncJobPagination];
      expect(lastCall[0].connectionId).toBe(connection.id);
    });
  });
});
