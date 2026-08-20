/**
 * CustomersListPage — component tests
 *
 * Pre-existing coverage: loading / error / empty / data states and the
 * Clear-filters affordance.
 *
 * #2093 (epic #2086) adds the column-set assertions: the name-first `Customer`
 * column and its email-hash fallback, the removed standalone `Email Hash`
 * column, the shortened-but-fully-copyable `Customer ID`, the shared
 * `ConnectionCell` on `Last connection source` (including BOTH halves of its
 * caller contract — `?? null` and `loading`), the unchanged `hideBelow: 768`,
 * and mobile-card parity with the desktop identity.
 *
 * The email-hash fixtures are REAL 64-character SHA-256 hexes. Short stubs are
 * what let the first cut ship an uncapped bold hex blob as the mobile card
 * headline and a spelled-out hash as the row link's accessible name with a
 * green suite; never shorten them for convenience.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../test/test-utils';
import { mockMobileViewport } from '../../test/viewport';
import { CustomersListPage } from './customers-list-page';
import { shortenId } from '../../shared/ui/entity-label';
import type { Connection } from '../../features/connections/api/connections.types';
import type {
  CustomerProjection,
  PaginatedCustomers,
} from '../../features/customers/api/customers.types';

const ALLEGRO_CONNECTION_ID = '3f9c1d2e-8a7b-4c5d-9e0f-1a2b3c4d5e6f';
const NAMED_CUSTOMER_ID = 'ol_customer_74b1e9c03a2d48f6b85c1e70d92f4a36';
/**
 * Derived, never hand-written: the point of the cap assertion below is that the
 * CSS cap is sized for whatever `shortenId` actually emits (19 characters for an
 * `ol_customer_` id, past the old 18ch cap). A literal would keep passing if
 * `shortenId` changed shape.
 */
const NAMED_CUSTOMER_SHORT_ID = shortenId(NAMED_CUSTOMER_ID);

/**
 * Real SHA-256 hexes — 64 characters, which is what `emailHash` actually holds.
 * A short stub would hide every defect this length causes: the mobile card's
 * uncapped bold headline, the row link's spelled-out accessible name, and the
 * fact that the visible cell is truncated and needs `title` to stay readable.
 */
const NAMED_EMAIL_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ANON_EMAIL_HASH = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: ALLEGRO_CONNECTION_ID,
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

function makeCustomer(overrides: Partial<CustomerProjection> = {}): CustomerProjection {
  return {
    internalCustomerId: NAMED_CUSTOMER_ID,
    emailHash: NAMED_EMAIL_HASH,
    normalizedEmail: 'buyer@example.com',
    firstName: 'Jane',
    lastName: 'Smith',
    lastSeenAt: '2026-03-01T10:00:00.000Z',
    lastSourceConnectionId: ALLEGRO_CONNECTION_ID,
    createdAt: '2026-01-10T08:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * The nameless row. NOT a PII-disabled deployment: identity resolution creates
 * every projection with null names and only backfills them once an order carries
 * a shipping/billing name, so this is routine with `OL_STORE_PII=true`.
 */
const anonymousCustomer = makeCustomer({
  internalCustomerId: 'ol_customer_c08fa25d7e614b39ac72d1508f6b3e94',
  emailHash: ANON_EMAIL_HASH,
  normalizedEmail: null,
  firstName: null,
  lastName: null,
  lastSeenAt: '2026-02-15T12:00:00.000Z',
  lastSourceConnectionId: null,
});

const sampleCustomers: PaginatedCustomers = {
  items: [makeCustomer(), anonymousCustomer],
  total: 2,
  limit: 20,
  offset: 0,
};

function mockApi(
  customers: PaginatedCustomers | Promise<PaginatedCustomers> = sampleCustomers,
  connections: Connection[] = [makeConnection()],
  connectionOverrides: Record<string, unknown> = {},
): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    customers: { list: vi.fn().mockResolvedValue(customers) },
    connections: { list: vi.fn().mockResolvedValue(connections), ...connectionOverrides },
  });
}

describe('CustomersListPage', () => {
  afterEach(() => {
    cleanup();
    // Two tests stub `navigator` for the clipboard; inline cleanup would leak the
    // stub into every later test in the file if the assertion threw first.
    vi.unstubAllGlobals();
  });

  it('should show loading state initially', () => {
    const mockApiClient = createMockApiClient({
      customers: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApiClient });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show customers table when data loads', async () => {
    renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

    expect(await screen.findByText('Jane Smith')).toBeInTheDocument();
    expect(screen.getByText(ANON_EMAIL_HASH)).toBeInTheDocument();
    expect(screen.getByText(NAMED_CUSTOMER_SHORT_ID)).toBeInTheDocument();
  });

  it('should show error state when fetch fails', async () => {
    const mockApiClient = createMockApiClient({
      customers: {
        list: vi.fn().mockRejectedValue(new Error('Network error')),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApiClient });

    expect(await screen.findByText('Unable to load customers')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('should show empty state with a Browse orders CTA when no customers exist', async () => {
    const mockApiClient = createMockApiClient({
      customers: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<CustomersListPage />, { apiClient: mockApiClient });

    expect(await screen.findByText('No customers found')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Browse orders' });
    expect(cta).toHaveAttribute('href', '/orders');
  });

  it('should show a Clear filters button that clears filters when filters are active', async () => {
    const user = userEvent.setup();
    const mockApiClient = createMockApiClient({
      customers: {
        list: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 }),
      },
    });

    renderWithProviders(<CustomersListPage />, {
      apiClient: mockApiClient,
      route: '/customers?search=unknown',
    });

    expect(
      await screen.findByText('No customer projections match the current filters.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('link', { name: 'Browse orders' })).toBeInTheDocument();
  });

  describe('#2093 — name-first column set and the shared Connection cell', () => {
    it('renders exactly the four columns, in order', async () => {
      renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

      await screen.findByText('Jane Smith');
      // Sortable headers render a button plus a sort glyph inside the `th`, so
      // read textContent with the glyph stripped rather than the accessible name.
      const headers = screen
        .getAllByRole('columnheader')
        .map((h) => (h.textContent ?? '').replace(/[↕▲▼]/g, '').trim());
      expect(headers).toEqual(['Customer', 'Customer ID', 'Last connection source', 'Last seen']);
    });

    it('scopes the table so its row-wide vertical alignment rule can match', async () => {
      // `ConnectionCell` made the Source column the tallest thing on the row, so
      // the style guide's heuristic puts Customers in the "another column sets
      // the height -> align the whole row" branch. `DataTable` puts the caller's
      // className on the CONTAINER, so `.customers-table td` is a descendant
      // match; drop the className and the rule in `index.css` matches nothing.
      const { container } = renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

      await screen.findByText('Jane Smith');
      expect(container.querySelector('.data-table__container')).toHaveClass('customers-table');
    });

    it('leads the row with the customer name rather than an identifier', async () => {
      const { container } = renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

      await screen.findByText('Jane Smith');
      const firstCell = container.querySelector('.data-table__row td') as HTMLElement;
      expect(within(firstCell).getByText('Jane Smith')).toBeInTheDocument();
    });

    it('falls back to the email hash, qualified with a row-level fact, when no name was recorded', async () => {
      // A projection is born nameless and is only backfilled from an order's
      // shipping/billing name, so this is routine on a PII-ENABLED deployment.
      // The qualifier must therefore state what is true of the ROW, never claim
      // anything about `OL_STORE_PII` — on the one page a compliance reviewer
      // would check to confirm hash-only mode, that would be a false positive.
      const { container } = renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [anonymousCustomer], total: 1, limit: 20, offset: 0 }),
      });

      const hash = await screen.findByText(ANON_EMAIL_HASH);
      const stack = hash.closest('.customer-identity');
      expect(stack).not.toBeNull();
      expect(within(stack as HTMLElement).getByText('No name recorded')).toBeInTheDocument();
      expect(stack?.textContent).not.toMatch(/not stored|PII/i);
      // Still the FIRST cell — the fallback does not demote the column.
      expect(container.querySelector('.data-table__row td')).toContainElement(hash);
    });

    it("keeps the 64-character hash out of the row link's accessible name", async () => {
      // The `Customer` cell IS the row link (`DataTable` linkifies the first
      // cell whenever `rowHref` is set), so its text content is the link's
      // accessible name. CSS truncation clips pixels, not the accessibility
      // tree: without the hash hidden, a screen reader spells out 64 hex
      // characters. Same rule the Copy button two columns right already applies.
      renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [anonymousCustomer], total: 1, limit: 20, offset: 0 }),
      });

      const hash = await screen.findByText(ANON_EMAIL_HASH);
      expect(hash).toHaveAttribute('aria-hidden', 'true');

      const rowLink = hash.closest('a');
      expect(rowLink).not.toBeNull();
      expect(rowLink).toHaveAccessibleName('Customer, No name recorded');
      // Belt and braces: no link on the page announces the hash.
      expect(screen.queryByRole('link', { name: new RegExp(ANON_EMAIL_HASH) })).toBeNull();
    });

    it('keeps the full hash reachable to a sighted operator through title', async () => {
      // The hash is the server-side search key (`emailHash ILIKE`, which this
      // page's own search box accepts). The cell truncates it, and it now sits
      // inside the row `<a>` where drag-select starts a link drag — so without
      // `title` an operator can paste a hash IN but never get one OUT, on a
      // GDPR-erasure or support path. A `CopyableId` would be better still, but
      // it renders a <button>, and nesting one in the row anchor is exactly what
      // `docs/lessons.md` bans.
      renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [anonymousCustomer], total: 1, limit: 20, offset: 0 }),
      });

      const hash = await screen.findByText(ANON_EMAIL_HASH);
      expect(hash).toHaveAttribute('title', ANON_EMAIL_HASH);
      expect(hash.closest('a')?.querySelector('button')).toBeNull();
    });

    it('sorts by the rendered name under the unchanged `name` column id, nameless rows last', async () => {
      // Two invariants in one render. (1) The column id stays `name`: it is what
      // `useTableSort` round-trips through `?sort=`, so renaming it would make a
      // bookmarked `?sort=name:asc` resolve to no column and sort by NOTHING —
      // not by the default. (2) A nameless row sorts by a sentinel, not by its
      // hash, so those rows cluster at one end instead of scattering through
      // the alphabet at a value no operator can predict.
      const { container } = renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({
          items: [
            makeCustomer({ internalCustomerId: 'ol_customer_z1', firstName: 'Zoe', lastName: 'Zephyr' }),
            anonymousCustomer,
            makeCustomer({ internalCustomerId: 'ol_customer_a1', firstName: 'Alice', lastName: 'Anders' }),
          ],
          total: 3,
          limit: 20,
          offset: 0,
        }),
        route: '/customers?sort=name:asc',
      });

      await screen.findByText('Alice Anders');
      const firstCells = Array.from(
        container.querySelectorAll('.data-table__row td:first-child'),
      ).map((td) => (td.textContent ?? '').trim());
      expect(firstCells[0]).toBe('Alice Anders');
      expect(firstCells[1]).toBe('Zoe Zephyr');
      expect(firstCells[2]).toContain('No name recorded');
    });

    it('no longer renders a standalone Email Hash column', async () => {
      renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

      await screen.findByText('Jane Smith');
      expect(screen.queryByRole('columnheader', { name: /email hash/i })).toBeNull();
      // The named row's hash is gone from the table entirely — it survives only
      // as the no-name fallback and on the customer detail page.
      expect(screen.queryByText(NAMED_EMAIL_HASH)).toBeNull();
    });

    it('renders the customer id shortened, and Copy writes the full id', async () => {
      // `fireEvent`, not `userEvent`: stubbing the whole `navigator` for the
      // clipboard also removes what userEvent's pointer setup reads off it.
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [makeCustomer()], total: 1, limit: 20, offset: 0 }),
      });

      expect(await screen.findByText(NAMED_CUSTOMER_SHORT_ID)).toBeInTheDocument();
      // The raw 44-character id is never printed.
      expect(screen.queryByText(NAMED_CUSTOMER_ID)).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Copy customer ID for Jane Smith' }));
      expect(writeText).toHaveBeenCalledWith(NAMED_CUSTOMER_ID);
    });

    it('keeps the shortened customer id inside the shared id cap so it is not clipped a second time', () => {
      // The only assertable form of "not visually clipped" — jsdom measures
      // nothing. `.copyable-id__value` used to cap at 18ch, sized for a shortened
      // bare UUID (13 chars); `shortenId` emits 19 for an `ol_customer_` id, so
      // this column shipped an ellipsis appended to an already-elided id until
      // #2087 raised the cap. Reverting it silently breaks THIS page first.
      // `resolve(dirname(fileURLToPath(import.meta.url)), …)`, never
      // `new URL('…', import.meta.url)`: Vite rewrites the latter into an asset
      // URL at transform time, so `fileURLToPath` then throws on a non-file
      // scheme. Same idiom as `src/test/font-preload-manifest.test.ts`.
      const css = readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.css'),
        'utf8',
      );
      const rule = /\.copyable-id__value\s*\{[^}]*?max-width:\s*(\d+)ch/s.exec(css);
      expect(rule).not.toBeNull();
      expect(Number(rule?.[1])).toBeGreaterThanOrEqual(NAMED_CUSTOMER_SHORT_ID.length);
    });

    it('renders the source through the shared ConnectionCell — name over a shortened, copyable id', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });

      const { container } = renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [makeCustomer()], total: 1, limit: 20, offset: 0 }),
      });

      await screen.findByText('Jane Smith');
      const cell = await waitFor(() => {
        const found = container.querySelector('.connection-cell') as HTMLElement | null;
        expect(found).not.toBeNull();
        return found!;
      });

      expect(within(cell).getByRole('link', { name: 'Allegro Main' })).toHaveAttribute(
        'href',
        `/connections/${ALLEGRO_CONNECTION_ID}`,
      );
      expect(within(cell).getByText('3f9c1d2e…5e6f')).toBeInTheDocument();
      // Frame 03 specifies Customers as the no-adornment caller: the column
      // header already says what the connection is.
      expect(cell.querySelector('.connection-cell__adornment')).toBeNull();

      fireEvent.click(
        within(cell).getByRole('button', { name: 'Copy connection ID for Allegro Main' }),
      );
      expect(writeText).toHaveBeenCalledWith(ALLEGRO_CONNECTION_ID);
    });

    it('renders an em dash when the customer has no source connection', async () => {
      renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi({ items: [anonymousCustomer], total: 1, limit: 20, offset: 0 }),
      });

      await screen.findByText(ANON_EMAIL_HASH);
      expect(screen.getByLabelText('No value')).toBeInTheDocument();
    });

    it('issues one connections request for the whole page, never one per row', async () => {
      const getById = vi.fn();
      async function renderWith(items: CustomerProjection[]): Promise<number> {
        const connectionsList = vi.fn().mockResolvedValue([makeConnection()]);
        renderWithProviders(<CustomersListPage />, {
          apiClient: createMockApiClient({
            customers: {
              list: vi
                .fn()
                .mockResolvedValue({ items, total: items.length, limit: 20, offset: 0 }),
            },
            connections: { list: connectionsList, getById },
          }),
        });
        await screen.findAllByText('Allegro Main');
        return connectionsList.mock.calls.length;
      }

      const one = await renderWith([makeCustomer()]);
      cleanup();
      // Three rows: two share the same connection, the third names one that is
      // gone — the shapes that would each trigger their own fetch per row.
      const three = await renderWith([
        makeCustomer(),
        makeCustomer({ internalCustomerId: 'ol_customer_b2', emailHash: 'b2' + ANON_EMAIL_HASH.slice(2) }),
        makeCustomer({
          internalCustomerId: 'ol_customer_c3',
          emailHash: 'c3' + ANON_EMAIL_HASH.slice(2),
          lastSourceConnectionId: 'conn_deleted',
        }),
      ]);

      expect(one).toBe(1);
      expect(three).toBe(1);
      expect(getById).not.toHaveBeenCalled();
    });

    it('shows the connection loading state rather than Unknown on a cold load', async () => {
      // The `loading` half of ConnectionCell's caller contract: the page must
      // coalesce a map miss to `null`, so without forwarding the batched query's
      // loading state every row would read "Unknown" until it settles.
      const { container } = renderWithProviders(<CustomersListPage />, {
        apiClient: createMockApiClient({
          customers: { list: vi.fn().mockResolvedValue(sampleCustomers) },
          connections: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
        }),
      });

      await screen.findByText('Jane Smith');
      await waitFor(() => {
        expect(container.querySelector('.connection-cell [aria-busy="true"]')).not.toBeNull();
      });
      expect(screen.queryByText('Unknown')).toBeNull();
    });

    it('renders Unknown for a deleted source connection without falling back to a per-row fetch', async () => {
      // The `?? null` half: `Map.get()` misses with `undefined`, which the cell
      // reads as "resolve it yourself" and would turn back into one request per
      // row. Resolved-but-absent must render Unknown and fetch nothing.
      const getById = vi.fn();
      const { container } = renderWithProviders(<CustomersListPage />, {
        apiClient: mockApi(
          { items: [makeCustomer()], total: 1, limit: 20, offset: 0 },
          [makeConnection({ id: 'conn_other' })],
          { getById },
        ),
      });

      await screen.findByText('Jane Smith');
      const cell = await waitFor(() => {
        const found = container.querySelector('.connection-cell') as HTMLElement | null;
        expect(found).not.toBeNull();
        return found!;
      });
      await waitFor(() => {
        expect(within(cell).getByText('Unknown')).toBeInTheDocument();
      });
      expect(getById).not.toHaveBeenCalled();
    });

    it('reads connections unfiltered, so a disabled one still resolves and shows its status note', async () => {
      // The batched read must not be filtered to active connections: a disabled
      // one that still owns rows would resolve to `null` and read "Unknown",
      // dropping the very status note line 2 exists to carry.
      //
      // The status assertion alone does NOT pin that, because the mock ignores
      // its argument — switching the page to `useConnectionsQuery({ status:
      // 'active' })` would keep it green. `useConnectionsQuery` passes `filters`
      // straight into `apiClient.connections.list(filters)`, so the argument is
      // observable; assert it.
      const apiClient = mockApi({ items: [makeCustomer()], total: 1, limit: 20, offset: 0 }, [
        makeConnection({ status: 'disabled' }),
      ]);
      const { container } = renderWithProviders(<CustomersListPage />, { apiClient });

      await screen.findByText('Jane Smith');
      const listConnections = apiClient.connections.list as ReturnType<typeof vi.fn>;
      await waitFor(() => {
        expect(listConnections).toHaveBeenCalled();
      });
      for (const [filters] of listConnections.mock.calls) {
        expect(filters).toBeUndefined();
      }
      const cell = await waitFor(() => {
        const found = container.querySelector('.connection-cell') as HTMLElement | null;
        expect(found).not.toBeNull();
        return found!;
      });
      await waitFor(() => {
        expect(within(cell).getByText('Allegro Main')).toBeInTheDocument();
      });
      expect(within(cell).getByText('Disabled')).toBeInTheDocument();
      expect(within(cell).queryByText('Unknown')).toBeNull();
    });

    it('keeps the source column hidden below 768px, so the page needs no tablet fold', async () => {
      renderWithProviders(<CustomersListPage />, { apiClient: mockApi() });

      await screen.findByText('Jane Smith');
      const header = screen.getByRole('columnheader', { name: 'Last connection source' });
      // `hideBelow` is a class, so the breakpoint is assertable. At 768 the
      // column survives tablet width — which is why #2094 (S8) skips this page.
      expect(header).toHaveClass('data-table__cell--hide-below-768');
      expect(header.className).not.toMatch(/hide-below-1024/);
      // …and therefore renders no `.conn-fold`: the fold exists to rescue a fact
      // a 1024 gate would drop, and this page never drops it (#2094).
      expect(document.querySelector('.conn-fold')).toBeNull();
    });

    it('headlines the mobile card with the same identity, text-only', async () => {
      const viewport = mockMobileViewport();
      try {
        const { container } = renderWithProviders(<CustomersListPage />, {
          apiClient: mockApi({ items: [makeCustomer()], total: 1, limit: 20, offset: 0 }),
        });

        const title = (await waitFor(() => {
          const found = container.querySelector('.data-table__card-title');
          expect(found).not.toBeNull();
          return found;
        })) as HTMLElement;

        // This page sets `rowHref`, so `DataTableCard` wraps title + subtitle in
        // the row's own `<Link>`. Text-only is therefore a NECESSITY, not a
        // preference: a Copy button or the connection link here would nest
        // inside an anchor and its clicks would bubble to the card link (#2090).
        expect(title.closest('a')).not.toBeNull();
        expect(title.textContent).toBe('Jane Smith');
        expect(title.querySelector('a, button')).toBeNull();

        const subtitle = container.querySelector('.data-table__card-subtitle') as HTMLElement;
        expect(subtitle.textContent).toBe(NAMED_CUSTOMER_SHORT_ID);
        expect(subtitle.querySelector('a, button')).toBeNull();
        // The card no longer headlines the raw internal id it used to.
        expect(container.querySelector('.connection-cell')).toBeNull();
      } finally {
        viewport.restore();
      }
    });

    it('headlines the qualifier, not a raw hash, on a nameless mobile card', async () => {
      // `.data-table__card-title` is 13.5px/600 with `word-break: break-word`
      // and no cap, so headlining the desktop label here prints a REAL 64-char
      // hash as a three-to-four-line bold hex blob — and drops the qualifier
      // the desktop cell exists to supply, restoring the "reads as a bug" state
      // that branch was designed to avoid. The hash moves to the subtitle,
      // shortened, with the full value on `title`.
      const viewport = mockMobileViewport();
      try {
        const { container } = renderWithProviders(<CustomersListPage />, {
          apiClient: mockApi({ items: [anonymousCustomer], total: 1, limit: 20, offset: 0 }),
        });

        const title = (await waitFor(() => {
          const found = container.querySelector('.data-table__card-title');
          expect(found).not.toBeNull();
          return found;
        })) as HTMLElement;

        expect(title.textContent).toBe('No name recorded');
        expect(title.textContent).not.toContain(ANON_EMAIL_HASH);

        const subtitle = container.querySelector('.data-table__card-subtitle') as HTMLElement;
        const shortHash = subtitle.querySelector('.mono-text') as HTMLElement;
        expect(shortHash.textContent).toBe(shortenId(ANON_EMAIL_HASH));
        expect(shortHash).toHaveAttribute('title', ANON_EMAIL_HASH);
        // The customer id survives beside it — the card still mirrors the
        // desktop's second column.
        expect(subtitle.textContent).toContain(shortenId(anonymousCustomer.internalCustomerId));
        expect(subtitle.querySelector('a, button')).toBeNull();
      } finally {
        viewport.restore();
      }
    });
  });
});
