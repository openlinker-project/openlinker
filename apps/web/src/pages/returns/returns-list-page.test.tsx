import { cleanup, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { ReturnsListPage } from './returns-list-page';
import type { ReturnListItem, ReturnListResult } from '../../features/returns';
import type { Connection } from '../../features/connections/api/connections.types';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'Allegro Main',
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

function makeReturn(overrides: Partial<ReturnListItem> = {}): ReturnListItem {
  return {
    id: 'ol_return_aaaaaaaa1111',
    sourceConnectionId: 'conn_1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_bbbbbbbb2222',
    externalOrderId: 'ORD-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: 'COMMISSION_REFUND_CLAIMED',
    openedAt: '2026-01-01T00:00:00.000Z',
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    counters: {
      lineCount: 1,
      notReturnedLineCount: 0,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 0,
      quantityReceived: 0,
      quantityRestocked: 0,
      quantityScrapped: 0,
    },
    ...overrides,
  };
}

interface ListResultOverrides {
  items?: ReturnListItem[];
  total?: number;
  counts?: { total: number; orphan: number; attributed: number };
  droppedCount?: number;
  envelopeUnreadable?: boolean;
  limit?: number;
}

function listResult(overrides: ListResultOverrides = {}): ReturnListResult {
  const items = overrides.items ?? [];
  return {
    items,
    total: overrides.total ?? items.length,
    limit: overrides.limit ?? 20,
    offset: 0,
    counts: overrides.counts ?? { total: items.length, orphan: 0, attributed: items.length },
    stageCounts: null,
    droppedCount: overrides.droppedCount ?? 0,
    envelopeUnreadable: overrides.envelopeUnreadable ?? false,
  };
}

interface SetupOptions {
  list?: ReturnListResult;
  configured?: boolean;
  availabilityPending?: boolean;
  connections?: Connection[];
  route?: string;
}

interface SetupResult extends RenderResult {
  listFn: Mock;
  availabilityFn: Mock;
}

function setup(options: SetupOptions = {}): SetupResult {
  const listFn = vi.fn().mockResolvedValue(options.list ?? listResult());
  const availabilityFn = options.availabilityPending
    ? vi.fn().mockReturnValue(new Promise(() => undefined))
    : vi.fn().mockResolvedValue({
        configured: options.configured ?? true,
        connectionIds: [],
      });

  const apiClient = createMockApiClient({
    returns: { list: listFn, getIngestionAvailability: availabilityFn },
    connections: { list: vi.fn().mockResolvedValue(options.connections ?? []) },
  });

  const result = renderWithProviders(<ReturnsListPage />, {
    apiClient,
    route: options.route ?? '/returns',
  });

  return { ...result, listFn, availabilityFn };
}

describe('ReturnsListPage', () => {
  afterEach(cleanup);

  describe('the two totals', () => {
    it('should render the bucket-less counts on the chips, not the bucket-applied total', async () => {
      // The whole point of the split: with `bucket=orphan` active the server's
      // `total` is 3, but the chips must keep describing the full scope — a chip
      // fed from `total` would show the Matched bucket as empty when it is not.
      setup({
        route: '/returns?bucket=orphan',
        list: listResult({
          items: [makeReturn({ bucket: 'orphan', internalOrderId: null })],
          total: 3,
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      expect(await screen.findByRole('button', { name: /All \(47\)/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Orphan \(3\)/ })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Matched to an order \(44\)/ }),
      ).toBeInTheDocument();
    });

    it('should paginate against the bucket-applied total, not the bucket-less counts', async () => {
      // 3 rows in the active bucket = one page, so Next must be disabled even
      // though the bucket-less total (47) spans several.
      setup({
        route: '/returns?bucket=orphan',
        list: listResult({
          items: [makeReturn({ bucket: 'orphan', internalOrderId: null })],
          total: 3,
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      expect(await screen.findByText('Showing 1–3 of 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it('should render the chips without numbers when the counts are unreadable', async () => {
      // Better a chip with no number than a fabricated one: the alternative is
      // an invented partition rendered as authoritative.
      setup({
        list: { ...listResult({ items: [makeReturn()], total: 1 }), counts: null },
      });

      expect(await screen.findByRole('button', { name: 'All' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Orphan' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Matched to an order' })).toBeInTheDocument();
    });

    it('should enable Next while the bucket-applied total exceeds the page', async () => {
      setup({
        list: listResult({
          items: [makeReturn()],
          total: 47,
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      expect(await screen.findByText('Showing 1–20 of 47')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    });

    it('should report the range the server APPLIED, not the page size it asked for', async () => {
      // They agree on a default deployment, so reading the request would be
      // true by coincidence. Reading the response makes it structurally true.
      setup({
        list: listResult({
          items: [makeReturn()],
          total: 47,
          limit: 5,
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      expect(await screen.findByText('Showing 1–5 of 47')).toBeInTheDocument();
    });
  });

  describe('empty branches', () => {
    it('should distinguish "not set up" from "no returns" when nothing can ingest returns', async () => {
      setup({ configured: false });

      expect(await screen.findByText('Returns ingestion is not set up')).toBeInTheDocument();
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
    });

    it('should say "no returns recorded yet" when ingestion IS configured', async () => {
      setup({ configured: true });

      expect(await screen.findByText('No returns recorded yet')).toBeInTheDocument();
      expect(screen.queryByText('Returns ingestion is not set up')).not.toBeInTheDocument();
    });

    it('should say "no matches" when a filter is active, never claiming the set is empty', async () => {
      setup({ route: '/returns?bucket=orphan', configured: false });

      expect(await screen.findByText('No returns match these filters')).toBeInTheDocument();
      // A filtered empty page says nothing about the deployment's configuration.
      expect(screen.queryByText('Returns ingestion is not set up')).not.toBeInTheDocument();
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
    });

    it('should report paging past the end rather than claiming there are no returns', async () => {
      // `offset` is paging, not a filter. Without this branch `?offset=999` on a
      // deployment with 47 returns tells the operator they have none.
      setup({ route: '/returns?offset=999', list: listResult({ items: [], total: 47 }) });

      expect(await screen.findByText('Nothing on this page')).toBeInTheDocument();
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
      expect(screen.queryByText('No returns match these filters')).not.toBeInTheDocument();
    });

    it('should return to the first page from the past-the-end state', async () => {
      const user = userEvent.setup();
      const { listFn } = setup({
        route: '/returns?offset=999',
        list: listResult({ items: [], total: 47 }),
      });

      await user.click(await screen.findByRole('button', { name: 'Back to first page' }));

      await waitFor(() => {
        expect(listFn).toHaveBeenLastCalledWith(expect.anything(), { limit: 20, offset: 0 });
      });
    });

    it('should not claim either unfiltered state before ingestion availability settles', async () => {
      // Otherwise "No returns recorded yet." paints and a second later swaps to
      // "not set up" — two contradictory claims in one second.
      setup({ availabilityPending: true });

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Returns ingestion is not set up')).not.toBeInTheDocument();
    });

    it('should fall back to the neutral empty state when availability cannot be read', async () => {
      const apiClient = createMockApiClient({
        returns: {
          list: vi.fn().mockResolvedValue(listResult()),
          getIngestionAvailability: vi.fn().mockResolvedValue(null),
        },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      renderWithProviders(<ReturnsListPage />, { apiClient, route: '/returns' });

      expect(await screen.findByText('No returns recorded yet')).toBeInTheDocument();
      expect(screen.queryByText('Returns ingestion is not set up')).not.toBeInTheDocument();
    });
  });

  describe('rows', () => {
    it('should badge an orphan return and keep the source order reference visible', async () => {
      setup({
        list: listResult({
          items: [
            makeReturn({ bucket: 'orphan', internalOrderId: null, externalOrderId: 'ORD-999' }),
          ],
          counts: { total: 1, orphan: 1, attributed: 0 },
        }),
      });

      // Scoped to the table: the filter chip also renders the word "Orphan", so
      // an unscoped query resolves against the chip while the rows are still
      // loading and asserts nothing about the row.
      await screen.findByText('RET-1');
      const table = within(screen.getByRole('table'));
      expect(table.getByText('Orphan')).toBeInTheDocument();
      // Independent parts, never one ternary — the badge must not hide the
      // reference the re-attribution pass resolves the orphan by.
      expect(table.getByText('ORD-999')).toBeInTheDocument();
    });

    it('should render the source status verbatim and attributed', async () => {
      setup({ list: listResult({ items: [makeReturn({ rawStatus: 'ODRZUCONY_PRZEZ_SPRZEDAWCE' })] }) });

      const status = await screen.findByText('Source: ODRZUCONY_PRZEZ_SPRZEDAWCE');
      expect(status).toHaveAttribute(
        'title',
        expect.stringContaining('OpenLinker does not interpret this value'),
      );
    });

    it('should say the source reported nothing rather than showing a blank status', async () => {
      setup({ list: listResult({ items: [makeReturn({ rawStatus: null })] }) });

      expect(await screen.findByText('Not reported')).toBeInTheDocument();
    });

    // #2377 replaced the declined-only status cell with the derived stage.
    // `declined` survives as stage #1, so the behaviour these pinned is still
    // pinned — they assert the same facts through the cell that renders now.
    it('should mark a declined return', async () => {
      setup({
        list: listResult({ items: [makeReturn({ declinedAt: '2026-02-01T00:00:00.000Z' })] }),
      });

      expect(await screen.findByText('Declined')).toBeInTheDocument();
    });

    it('should not mark a return the source has not declined', async () => {
      setup({ list: listResult({ items: [makeReturn({ declinedAt: null })] }) });

      await screen.findByText('RET-1');
      expect(screen.queryByText('Declined')).not.toBeInTheDocument();
    });

    it('should render the derived stage and its counter line', async () => {
      setup({
        list: listResult({
          items: [
            makeReturn({
              counters: {
                lineCount: 1,
                notReturnedLineCount: 0,
                quantityAdvised: 5,
                notReturnedQuantityAdvised: 0,
                quantityReceived: 3,
                quantityRestocked: 0,
                quantityScrapped: 0,
              },
            }),
          ],
        }),
      });

      expect(await screen.findByText('Partially received')).toBeInTheDocument();
      // The counters sit adjacent to the label and read from the SAME aggregate,
      // so the two can never disagree (spec § 4.2).
      expect(screen.getByText('3 of 5 received')).toBeInTheDocument();
    });

    it('should mark an operator-authored return', async () => {
      setup({ list: listResult({ items: [makeReturn({ origin: 'operator_authored' })] }) });

      expect(await screen.findByText('Recorded by you')).toBeInTheDocument();
    });

    it('should report rows it could not read instead of silently showing fewer', async () => {
      setup({ list: listResult({ items: [makeReturn()], total: 2, droppedCount: 1 }) });

      expect(
        await screen.findByText(/1 return on this page could not be read and is not shown/),
      ).toBeInTheDocument();
    });

    it('should say the page could not be read when EVERY row failed to parse', async () => {
      // A page of unreadable rows is not an empty page. Falling through to the
      // empty branches would blank the table and claim the operator has no
      // returns — the same false claim, arriving by a different route.
      setup({ list: listResult({ items: [], total: 47, droppedCount: 20 }) });

      expect(await screen.findByText('Returns could not be read')).toBeInTheDocument();
      expect(
        screen.getByText(/20 returns on this page could not be read and are not shown/),
      ).toBeInTheDocument();
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Nothing on this page')).not.toBeInTheDocument();
    });

    it('should say so when the WHOLE envelope was unreadable, never "no returns"', async () => {
      // The envelope failure yields no rows AND no drops, so every emptiness
      // test reads it as the server confirming there are none — the parse layer
      // reports it separately precisely because a row counter cannot see it.
      // `counts: null` also blanks the chips, so this branch is the only signal
      // left.
      setup({
        list: listResult({ items: [], total: 0, droppedCount: 0, envelopeUnreadable: true }),
      });

      expect(await screen.findByText('Returns could not be read')).toBeInTheDocument();
      expect(
        screen.getByText(/came back in a shape this version of OpenLinker could not read/),
      ).toBeInTheDocument();
      expect(screen.queryByText('No returns recorded yet')).not.toBeInTheDocument();
      expect(screen.queryByText('Returns ingestion is not set up')).not.toBeInTheDocument();
    });

    it('should prefer the unreadable state over the past-the-end state', async () => {
      setup({
        route: '/returns?offset=999',
        list: listResult({ items: [], total: 47, droppedCount: 20 }),
      });

      expect(await screen.findByText('Returns could not be read')).toBeInTheDocument();
      expect(screen.queryByText('Nothing on this page')).not.toBeInTheDocument();
    });
  });

  describe('filters', () => {
    it('should send the selected bucket to the API and reset the offset', async () => {
      const user = userEvent.setup();
      const { listFn } = setup({
        route: '/returns?offset=40',
        list: listResult({
          items: [makeReturn()],
          total: 47,
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      await user.click(await screen.findByRole('button', { name: /Orphan \(3\)/ }));

      await waitFor(() => {
        expect(listFn).toHaveBeenLastCalledWith(
          expect.objectContaining({ bucket: 'orphan' }),
          { limit: 20, offset: 0 },
        );
      });
    });

    it('should clear the filters back to an unfiltered request', async () => {
      const user = userEvent.setup();
      const { listFn } = setup({
        route: '/returns?bucket=orphan',
        list: listResult({
          items: [makeReturn({ bucket: 'orphan', internalOrderId: null })],
          counts: { total: 47, orphan: 3, attributed: 44 },
        }),
      });

      await user.click(await screen.findByRole('button', { name: 'Clear filters' }));

      await waitFor(() => {
        expect(listFn).toHaveBeenLastCalledWith(
          expect.objectContaining({ bucket: undefined }),
          { limit: 20, offset: 0 },
        );
      });
    });

    it('should ignore an unrecognised bucket in the URL rather than forwarding it', async () => {
      const { listFn } = setup({ route: '/returns?bucket=declined' });

      await waitFor(() => {
        expect(listFn).toHaveBeenCalledWith(
          expect.objectContaining({ bucket: undefined }),
          expect.anything(),
        );
      });
    });

    it('should offer the source connections as a filter', async () => {
      setup({ connections: [makeConnection({ id: 'conn_1', name: 'Allegro Main' })] });

      const select = await screen.findByLabelText('Filter by source connection');
      expect(select).toBeInTheDocument();
      expect(await screen.findByRole('option', { name: 'Allegro Main' })).toBeInTheDocument();
    });
  });

  describe('failure', () => {
    it('should render an error state with a retry', async () => {
      const apiClient = createMockApiClient({
        returns: {
          list: vi.fn().mockRejectedValue(new Error('boom')),
          getIngestionAvailability: vi
            .fn()
            .mockResolvedValue({ configured: true, connectionIds: [] }),
        },
        connections: { list: vi.fn().mockResolvedValue([]) },
      });

      renderWithProviders(<ReturnsListPage />, { apiClient, route: '/returns' });

      expect(await screen.findByText('Unable to load returns')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });
});
