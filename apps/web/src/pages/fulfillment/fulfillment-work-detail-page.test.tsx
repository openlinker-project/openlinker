/**
 * `FulfillmentWorkDetailPage` (#3098; access, title and action card #3096).
 *
 * Five states that must not impersonate one another, a title that names the
 * ORDER, a back link that must not throw away the operator's filters, and the
 * admin + operator gate.
 *
 * ## What is deliberately NOT re-asserted here
 *
 * `summariseFulfillmentWork`'s precedence, the body's cards and
 * `useFulfillmentWorkQuery`'s key each have their own suite. What is tested
 * here is what THIS page does with those answers.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { FulfillmentWorkDetailPage } from './fulfillment-work-detail-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastDescription,
  renderWithProviders,
} from '../../test/test-utils';
import {
  FULFILLMENT_ACTION_COPY,
  FULFILLMENT_WORK_DETAIL_COPY,
  fulfillmentActionLabel,
  type FulfillmentTask,
} from '../../features/fulfillment';
import { holdReasonLabel } from '../../features/orders';
import { ApiError } from '../../shared/api/api-error';
import type { SessionAdapter } from '../../shared/auth/session-adapter';

afterEach(cleanup);

const COPY = FULFILLMENT_WORK_DETAIL_COPY;

const getMock = (): GetMock => vi.fn<(workId: string) => Promise<FulfillmentTask>>();
const WORK_ID = 'ol_work_1';

function task(overrides: Partial<FulfillmentTask> = {}): FulfillmentTask {
  return {
    id: WORK_ID,
    orderId: 'ol_order_a1b2c3d4e5f60718293a4b5c6d7e8f90',
    orderReference: null,
    locationId: 'loc_warsaw',
    deliveryMethod: 'courier',
    assignedConnectionId: null,
    assignedToUserId: null,
    selfServeEligible: true,
    status: 'in_progress',
    requestStatus: 'accepted',
    assignmentAttempt: 1,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: '2026-09-10T09:00:00.000Z',
    cancelledAt: null,
    expeditedAt: null,
    createdAt: '2026-09-10T08:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    lines: [],
    activeHolds: [],
    supportedActions: ['close'],
    version: 3,
    ...overrides,
  };
}

/** The one read this page makes. Typed so a fixture cannot drift from it. */
type GetMock = Mock<(workId: string) => Promise<FulfillmentTask>>;
/** The one WRITE it makes (#3101). */
type ApplyMock = Mock<
  (workId: string, action: string, body: Record<string, unknown>) => Promise<FulfillmentTask>
>;

const applyMock = (): ApplyMock =>
  vi.fn<
    (workId: string, action: string, body: Record<string, unknown>) => Promise<FulfillmentTask>
  >();

function renderPage(
  opts: {
    get?: GetMock;
    route?: string;
    applyAction?: ApplyMock;
    sessionAdapter?: SessionAdapter;
  } = {}
): ReturnType<typeof renderWithProviders> & { get: GetMock; applyAction: ApplyMock } {
  const get = opts.get ?? getMock().mockResolvedValue(task());
  const applyAction = opts.applyAction ?? applyMock().mockResolvedValue(task());
  const apiClient = createMockApiClient({
    fulfillment: { get, applyAction } as never,
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
    // The right-hand column's reads, settled so no assertion races a stray
    // pending query. The order read fails on purpose: the rail then renders
    // one quiet "unavailable" card instead of the order page's whole panels.
    orders: { getById: vi.fn().mockRejectedValue(new ApiError('boom', 500, null)) } as never,
    users: { listPackers: vi.fn().mockResolvedValue({ packers: [] }) } as never,
    inventory: {
      listActiveLocations: vi.fn().mockResolvedValue({ items: [], total: 1, page: 1, limit: 1 }),
    } as never,
  });

  const result = renderWithProviders(
    <Routes>
      <Route path="/fulfillment/works/:workId" element={<FulfillmentWorkDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: opts.route ?? `/fulfillment/works/${WORK_ID}`,
      sessionAdapter: opts.sessionAdapter ?? createAuthenticatedSessionAdapter(),
    }
  );

  return { ...result, get, applyAction };
}

async function findHero(): Promise<HTMLElement> {
  return await screen.findByTestId('work-detail-hero');
}

/** The actions region, so a query cannot pick up the back link or a body control. */
function actionsRegion(): HTMLElement {
  return document.querySelector('.fulfilment-work-detail__actions') as HTMLElement;
}

/** Every action control, IN DOM ORDER — order matters as much as membership. */
function actionLabels(): string[] {
  const region = actionsRegion();
  if (region === null) return [];
  return within(region)
    .queryAllByRole('button')
    .map((button) => button.textContent?.trim() ?? '');
}

function hold(id: string, reason: string): FulfillmentTask['activeHolds'][number] {
  return { id, reason, note: null, placedAt: '2026-09-10T08:30:00.000Z' };
}

/** A session that can read orders and may not open fulfilment tasks. */
const VIEWER = createAuthenticatedSessionAdapter({
  id: 'user_9',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
});

/** A session whose whole job is the bench. */
const PACKER = createAuthenticatedSessionAdapter({
  id: 'user_7',
  username: 'packer',
  email: null,
  role: 'packer',
  permissions: ['bench:write'],
});

describe('FulfillmentWorkDetailPage', () => {
  describe('who may open it (#3096)', () => {
    it('should render access denied, and never send the read, when the session lacks orders:write', async () => {
      const { get } = renderPage({ sessionAdapter: VIEWER });

      expect(await screen.findByRole('heading', { name: COPY.states.denied.title })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: COPY.states.error.retry })).not.toBeInTheDocument();
      expect(get).not.toHaveBeenCalled();
    });

    it('should point a bench-only session at the bench when it lands here', async () => {
      renderPage({ sessionAdapter: PACKER });

      const link = await screen.findByRole('link', { name: COPY.states.deniedBench.action });
      expect(link).toHaveAttribute('href', '/bench');
    });

    it('should render access denied rather than an error with Retry when the read answers 403', async () => {
      renderPage({ get: getMock().mockRejectedValue(new ApiError('Insufficient permissions', 403, null)) });

      expect(await screen.findByRole('heading', { name: COPY.states.denied.title })).toBeInTheDocument();
      expect(screen.queryByText(COPY.states.error.title)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: COPY.states.error.retry })).not.toBeInTheDocument();
    });
  });

  describe('the states', () => {
    it('should render the card skeleton while the read is in flight', () => {
      renderPage({ get: getMock().mockImplementation(() => new Promise<FulfillmentTask>(() => {})) });

      return waitFor(() => {
        expect(screen.getByText(COPY.states.loading.title)).toHaveClass('sr-only');
        expect(document.querySelectorAll('.detail-card').length).toBeGreaterThan(0);
      });
    });

    it('should render a NOT-FOUND state for a 404, never the error state', async () => {
      renderPage({ get: getMock().mockRejectedValue(new ApiError('nope', 404, null)) });

      expect(await screen.findByText(COPY.states.notFound.message)).toBeInTheDocument();
      expect(screen.queryByText(COPY.states.error.title)).not.toBeInTheDocument();
    });

    it('should render an error state with a retry for any other failure', async () => {
      const get = getMock()
        .mockRejectedValueOnce(new ApiError('boom', 500, null))
        .mockResolvedValue(task());
      renderPage({ get });

      expect(await screen.findByText(COPY.states.error.title)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: COPY.states.error.retry })).toBeInTheDocument();
    });
  });

  describe('the title and the way to the order', () => {
    it('should title the page with the order reference when the order carries one', async () => {
      renderPage({ get: getMock().mockResolvedValue(task({ orderReference: 'C71A02' })) });

      expect(await screen.findByRole('heading', { level: 2, name: 'Order C71A02' })).toBeInTheDocument();
    });

    it('should shorten a long reference the way the orders lists do', async () => {
      renderPage({
        get: getMock().mockResolvedValue(task({ orderReference: '1a7a9550-bd84-11f1-a5f3-e32e252d5e3f' })),
      });

      expect(await screen.findByRole('heading', { level: 2, name: 'Order 1a7a9550…2d5e3f' })).toBeInTheDocument();
    });

    it('should fall back to the shortened internal id when the order has no reference', async () => {
      renderPage();

      const title = await screen.findByRole('heading', { level: 2, name: /^Order / });
      expect(title.textContent).toMatch(/^Order /);
      expect(title.textContent).not.toContain('ol_order_a1b2c3d4e5f60718293a4b5c6d7e8f90');
    });

    it('should offer an Open order action that links to the order page', async () => {
      renderPage();

      const link = await screen.findByRole('link', { name: COPY.openOrder });
      expect(link).toHaveAttribute('href', '/orders/ol_order_a1b2c3d4e5f60718293a4b5c6d7e8f90');
    });
  });

  describe('the hero', () => {
    it('should join BOTH axis labels in the headline, because neither carries the other', async () => {
      renderPage();

      const hero = await findHero();
      expect(within(hero).getByText('In progress · Accepted')).toBeInTheDocument();
    });

    it('should render the derived sentence when the build can say one', async () => {
      renderPage();

      expect(
        await screen.findByText(COPY.summary.inProgress(COPY.summary.executorFallback))
      ).toBeInTheDocument();
    });
  });

  describe('the back link', () => {
    it('should carry the board state back, through the shared whitelist', async () => {
      renderPage({ route: `/fulfillment/works/${WORK_ID}?orderId=ol_order_7&offset=50&groupBy=packer` });

      const back = await screen.findByRole('link', { name: COPY.backToWorklist });
      expect(back).toHaveAttribute('href', '/fulfillment?orderId=ol_order_7&offset=50&groupBy=packer');
    });

    it('should drop a legacy locationId from the back link (#3096)', async () => {
      renderPage({ route: `/fulfillment/works/${WORK_ID}?locationId=loc_krakow&offset=25` });

      const back = await screen.findByRole('link', { name: COPY.backToWorklist });
      expect(back).toHaveAttribute('href', '/fulfillment?offset=25');
    });

    it('should link to the bare worklist when there are no params to carry', async () => {
      renderPage();

      expect(await screen.findByRole('link', { name: COPY.backToWorklist })).toHaveAttribute(
        'href',
        '/fulfillment'
      );
    });

    it('should offer the back link on the failure branches too', async () => {
      renderPage({ get: getMock().mockRejectedValue(new ApiError('nope', 404, null)) });

      expect(await screen.findByText(COPY.states.notFound.message)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: COPY.backToWorklist })).toBeInTheDocument();
    });
  });

  it('should request the task named in the route, not some other one', async () => {
    const { get } = renderPage({ route: `/fulfillment/works/ol_work_other` });

    await findHero();
    expect(get).toHaveBeenCalledWith('ol_work_other');
  });
});

/**
 * The action card (#3101; card + 32 px buttons #3096).
 *
 * `readFulfillmentConflict`, `FulfillmentTaskActions` and
 * `useFulfillmentTaskActionRunner` each have their own spec. What is covered
 * here is what the DETAIL page does with them.
 */
describe('FulfillmentWorkDetailPage - the action card', () => {
  it('should render the action card as a detail card with its small label', async () => {
    renderPage();

    const card = await screen.findByRole('region', { name: COPY.sections.actions });
    expect(card).toHaveClass('detail-card', 'detail-card--actions');
    expect(within(card).getByText(COPY.sections.actions)).toHaveClass('fulfilment-work-detail__actions-label');
  });

  it('should render full-size buttons, not the dense 28 px ones', async () => {
    renderPage();

    await findHero();
    const close = within(actionsRegion()).getByRole('button', {
      name: FULFILLMENT_ACTION_COPY['close'].label,
    });
    expect(close).not.toHaveClass('button--sm');
  });

  it('should render exactly the server’s supportedActions, in the served order', async () => {
    renderPage({
      get: getMock().mockResolvedValue(task({ supportedActions: ['close', 'hold', 'force_cancel'] })),
    });

    await findHero();
    expect(actionLabels()).toEqual([
      FULFILLMENT_ACTION_COPY['close'].label,
      FULFILLMENT_ACTION_COPY['hold'].label,
      FULFILLMENT_ACTION_COPY['force_cancel'].label,
    ]);
  });

  it('should still render an action this build has no copy for', async () => {
    expect(FULFILLMENT_ACTION_COPY['quarantine_parcel']).toBeUndefined();

    renderPage({
      get: getMock().mockResolvedValue(task({ supportedActions: ['close', 'quarantine_parcel'] })),
    });

    await findHero();
    expect(actionLabels()).toEqual([FULFILLMENT_ACTION_COPY['close'].label, 'Quarantine parcel']);
    expect(fulfillmentActionLabel('quarantine_parcel')).toBe('Quarantine parcel');
  });

  it('should render the nothing-left sentence when the server offers no action', async () => {
    renderPage({ get: getMock().mockResolvedValue(task({ supportedActions: [] })) });

    expect(await screen.findByText(COPY.actions.nothingLeft)).toBeInTheDocument();
    expect(actionLabels()).toEqual([]);
  });

  it('should give each hold its own release control when a task carries more than one', async () => {
    renderPage({
      get: getMock().mockResolvedValue(
        task({
          supportedActions: ['release_hold'],
          activeHolds: [hold('hold_1', 'stock-shortfall'), hold('hold_2', 'address-invalid')],
        })
      ),
    });

    await findHero();
    expect(actionLabels()).toEqual([
      `${FULFILLMENT_ACTION_COPY['release_hold'].label} (${holdReasonLabel('stock-shortfall')})`,
      `${FULFILLMENT_ACTION_COPY['release_hold'].label} (${holdReasonLabel('address-invalid')})`,
    ]);
  });

  it('should send the version it RENDERED, and refresh instead of retrying, on a version_conflict', async () => {
    const user = userEvent.setup();
    const get = getMock()
      .mockResolvedValueOnce(task({ version: 3, supportedActions: ['close'] }))
      .mockResolvedValue(task({ version: 4, supportedActions: ['hold'] }));
    const applyAction = applyMock().mockRejectedValue(
      new ApiError('stale', 409, {
        code: 'version_conflict',
        currentVersion: 4,
        supportedActions: ['hold'],
      })
    );

    renderPage({ get, applyAction });

    await findHero();
    await user.click(
      within(actionsRegion()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    expect(applyAction).toHaveBeenCalledWith(
      WORK_ID,
      'close',
      expect.objectContaining({ expectedVersion: 3 })
    );
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(actionLabels()).toEqual([FULFILLMENT_ACTION_COPY['hold'].label]);
    });
    expect(applyAction).toHaveBeenCalledTimes(1);

    const toast = await findToastDescription(/Somebody moved this fulfilment task/);
    expect(toast.closest('.toast')).toHaveClass('toast--warning');
  });

  it('should word an action_not_legal differently, and not retry it either', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockRejectedValue(
      new ApiError('not legal', 409, { code: 'action_not_legal', supportedActions: [] })
    );

    renderPage({ applyAction, get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })) });

    await findHero();
    await user.click(
      within(actionsRegion()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    const toast = await findToastDescription(/no longer possible/);
    expect(toast.closest('.toast')).toHaveClass('toast--error');
    expect(applyAction).toHaveBeenCalledTimes(1);
  });

  it('should toast an applied action, through the same surface as the failures', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockResolvedValue(task({ supportedActions: [] }));

    renderPage({ applyAction, get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })) });

    await findHero();
    await user.click(
      within(actionsRegion()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    expect(await findToastDescription(/applied\.$/)).toBeInTheDocument();
  });

  it('should open the confirmation form for an action that needs a field', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockResolvedValue(task());

    renderPage({ applyAction, get: getMock().mockResolvedValue(task({ supportedActions: ['hold'] })) });

    await findHero();
    await user.click(
      within(actionsRegion()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['hold'].label })
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(applyAction).not.toHaveBeenCalled();
  });

  it('should mark the whole region busy while an action is in flight', async () => {
    const user = userEvent.setup();
    let settle: (value: FulfillmentTask) => void = () => {};
    const applyAction = applyMock().mockImplementation(
      () =>
        new Promise<FulfillmentTask>((resolve) => {
          settle = resolve;
        })
    );

    renderPage({ applyAction, get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })) });

    await findHero();
    expect(actionsRegion()).toHaveAttribute('aria-busy', 'false');

    await user.click(
      within(actionsRegion()).getByRole('button', { name: FULFILLMENT_ACTION_COPY['close'].label })
    );

    await waitFor(() => {
      expect(actionsRegion()).toHaveAttribute('aria-busy', 'true');
    });

    settle(task({ supportedActions: [] }));
    await waitFor(() => {
      expect(actionsRegion()).toHaveAttribute('aria-busy', 'false');
    });
  });
});
