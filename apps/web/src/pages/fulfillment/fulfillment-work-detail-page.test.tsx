/**
 * `FulfillmentWorkDetailPage` (#3098).
 *
 * Four states that must not impersonate one another, and a back link that must
 * not throw away the operator's filters.
 *
 * ## What is deliberately NOT re-asserted here
 *
 * `summariseFulfillmentWork`'s precedence has its own 30-case suite, and
 * `useFulfillmentWorkQuery`'s key and disabled-guard have theirs. Re-running
 * either through this page would pass with this file's own body reverted. What
 * is untested anywhere else is what THIS page does with those answers, so that
 * is what is written below.
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
  FULFILLMENT_EXPEDITED_BADGE,
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
    demoMode?: boolean;
  } = {}
): ReturnType<typeof renderWithProviders> & { get: GetMock; applyAction: ApplyMock } {
  const get = opts.get ?? getMock().mockResolvedValue(task());
  const applyAction = opts.applyAction ?? applyMock().mockResolvedValue(task());
  const apiClient = createMockApiClient({
    fulfillment: { get, applyAction } as never,
    // Pinned rather than left to the factory's default: `useWriteAccess` reads
    // it, so a changed default would flip every action assertion below between
    // "enabled" and "disabled with a read-only tooltip".
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: opts.demoMode ?? false }) },
  });

  const result = renderWithProviders(
    <Routes>
      <Route path="/fulfillment/works/:workId" element={<FulfillmentWorkDetailPage />} />
    </Routes>,
    {
      apiClient,
      route: opts.route ?? `/fulfillment/works/${WORK_ID}`,
      sessionAdapter: opts.sessionAdapter ?? createAuthenticatedSessionAdapter(),
    },
  );

  return { ...result, get, applyAction };
}

/**
 * The hero, once the loaded branch has rendered.
 *
 * Scoping is load-bearing rather than tidy. The Details grid (#3100) renders
 * the SAME two axis values a second time, as labelled `State` and `Handshake`
 * rows, because the mockup shows each axis twice: glanceable in the hero, and
 * quotable in the grid beneath. So an unscoped `getByText('In progress')`
 * matches both and throws - and a query narrowed some other way (the first
 * match, a `queryAllByText` length) would stop proving WHICH surface rendered
 * it, which is the only thing these cases are about.
 */
async function findHero(): Promise<HTMLElement> {
  return await waitFor(() => {
    const hero = document.querySelector<HTMLElement>('.fulfilment-work-detail__hero');
    if (hero === null) throw new Error('the hero has not rendered yet');
    return hero;
  });
}

/**
 * The actions region, so a query cannot pick up the back link or a body
 * control by accident.
 */
function actionsRegion(): HTMLElement {
  return document.querySelector('.fulfilment-work-detail__actions') as HTMLElement;
}

/**
 * Every action control, IN DOM ORDER.
 *
 * Order matters as much as membership: a `.sort()` slipped into this page would
 * pass a set-equality assertion while silently reordering what the server sent.
 */
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

/** A session that can read fulfilment tasks and may not act on them. */
const VIEWER = createAuthenticatedSessionAdapter({
  id: 'user_9',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
});

describe('FulfillmentWorkDetailPage', () => {
  describe('the four states', () => {
    it('should render a loading state while the read is in flight', () => {
      renderPage({ get: getMock().mockImplementation(() => new Promise<FulfillmentTask>(() => {})) });

      expect(screen.getByText(COPY.states.loading.title)).toBeInTheDocument();
    });

    it('should render a NOT-FOUND state for a 404, never the error state', async () => {
      renderPage({
        get: getMock().mockRejectedValue(new ApiError('nope', 404, null)),
      });

      expect(await screen.findByText(COPY.states.notFound.message)).toBeInTheDocument();
      // The distinction is the whole point: a 404 is a fact about the URL, an
      // error is a fact about the request, and pointing an operator at the
      // wrong one sends them to debug a problem they do not have.
      expect(screen.queryByText(COPY.states.error.title)).not.toBeInTheDocument();
    });

    it('should render an error state with a retry for any other failure', async () => {
      const get = getMock()
        .mockRejectedValueOnce(new ApiError('boom', 500, null))
        .mockResolvedValue(task());
      renderPage({ get });

      expect(await screen.findByText(COPY.states.error.title)).toBeInTheDocument();
      expect(screen.queryByText(COPY.states.notFound.title)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: COPY.states.error.retry })).toBeInTheDocument();
    });

    it('should render the task once loaded', async () => {
      renderPage();

      // The ORDER, shortened - never the 32-character raw id the mockup's own
      // `toUpperCase()` would have shouted.
      expect(await screen.findByText(/^Order /)).toBeInTheDocument();
      expect(screen.queryByText(COPY.states.loading.title)).not.toBeInTheDocument();
    });
  });

  describe('the hero', () => {
    it('should render BOTH axis labels, because neither carries the other', async () => {
      renderPage({ get: getMock().mockResolvedValue(task()) });

      // Heldness lives in `activeHolds` and nothing writes `status: on_hold`,
      // so dropping or merging either axis loses a fact.
      const hero = await findHero();
      expect(within(hero).getByText('In progress')).toBeInTheDocument();
      expect(within(hero).getByText('Accepted')).toBeInTheDocument();
    });

    it('should render the derived sentence when the build can say one', async () => {
      renderPage({ get: getMock().mockResolvedValue(task()) });

      expect(
        await screen.findByText(COPY.summary.inProgress(COPY.summary.executorFallback)),
      ).toBeInTheDocument();
    });

    it('should render NO sentence rather than a hedge when it cannot', async () => {
      // `open` + `accepted` is a reachable state the derivation deliberately
      // says nothing about. The page must render the axes alone.
      renderPage({
        get: getMock().mockResolvedValue(task({ status: 'open', requestStatus: 'accepted' })),
      });

      const hero = await findHero();
      expect(within(hero).getByText('Accepted')).toBeInTheDocument();
      expect(
        document.querySelector('.fulfilment-work-detail__summary'),
      ).not.toBeInTheDocument();
    });

    it('should render the expedited badge only when the task carries the stamp', async () => {
      const { unmount } = renderPage({
        get: getMock().mockResolvedValue(task({ expeditedAt: '2026-09-10T11:00:00.000Z' })),
      });
      expect(await screen.findByText(FULFILLMENT_EXPEDITED_BADGE)).toBeInTheDocument();
      unmount();
      cleanup();

      renderPage({ get: getMock().mockResolvedValue(task({ expeditedAt: null })) });
      const hero = await findHero();
      expect(within(hero).getByText('In progress')).toBeInTheDocument();
      expect(screen.queryByText(FULFILLMENT_EXPEDITED_BADGE)).not.toBeInTheDocument();
    });
  });

  describe('the back link', () => {
    it('should carry the worklist search params back verbatim', async () => {
      renderPage({
        route: `/fulfillment/works/${WORK_ID}?status=in_progress&offset=50`,
      });

      const back = await screen.findByRole('link', { name: COPY.backToWorklist });
      // Verbatim, not re-derived: an operator who filtered and paged before
      // drilling in has done work, and this page has no opinion about what
      // those params mean.
      expect(back).toHaveAttribute('href', '/fulfillment?status=in_progress&offset=50');
    });

    it('should link to the bare worklist when there are no params to carry', async () => {
      renderPage();

      const back = await screen.findByRole('link', { name: COPY.backToWorklist });
      expect(back).toHaveAttribute('href', '/fulfillment');
    });

    it('should offer the back link on the failure branches too', async () => {
      renderPage({ get: getMock().mockRejectedValue(new ApiError('nope', 404, null)) });

      expect(await screen.findByText(COPY.states.notFound.message)).toBeInTheDocument();
      // A dead end is how an operator ends up using the browser's back button
      // and losing the list state this page just went to the trouble of
      // carrying.
      expect(screen.getByRole('link', { name: COPY.backToWorklist })).toBeInTheDocument();
    });
  });

  it('should request the task named in the route, not some other one', async () => {
    const { get } = renderPage({ route: `/fulfillment/works/ol_work_other` });

    await screen.findByText(/^Order /);
    expect(get).toHaveBeenCalledWith('ol_work_other');
  });
});

/**
 * The action region (#3101).
 *
 * ## What is deliberately NOT re-asserted here
 *
 * `readFulfillmentConflict` classifies both coded 409s and has its own spec;
 * `FulfillmentTaskActions` renders one control per entry and has its own; and
 * `useFulfillmentTaskActionRunner` owns the send. Re-running any of those
 * through this page would pass with this page's whole actions region deleted.
 * What is covered nowhere else is what the DETAIL page does with them - that it
 * mounts them at all, that its empty-set guard reads the permission as well as
 * the array, and that the version it sends is the one it drew - so that is what
 * is written below.
 */
describe('FulfillmentWorkDetailPage - the action region', () => {
  it('should render exactly the server’s supportedActions, in the served order', async () => {
    renderPage({
      get: getMock().mockResolvedValue(
        task({ supportedActions: ['close', 'hold', 'force_cancel'] }),
      ),
    });

    await screen.findByText(/^Order /);
    // Order as well as membership: a `.sort()` here would pass a set test.
    expect(actionLabels()).toEqual([
      FULFILLMENT_ACTION_COPY['close'].label,
      FULFILLMENT_ACTION_COPY['hold'].label,
      FULFILLMENT_ACTION_COPY['force_cancel'].label,
    ]);
  });

  it('should still render an action this build has no copy for', async () => {
    // Vacuity guard: the case means nothing unless this really is unknown.
    expect(FULFILLMENT_ACTION_COPY['quarantine_parcel']).toBeUndefined();

    renderPage({
      get: getMock().mockResolvedValue(
        task({ supportedActions: ['close', 'quarantine_parcel'] }),
      ),
    });

    await screen.findByText(/^Order /);
    // The humanising fallback, asserted as the literal it produces rather than
    // through `fulfillmentActionLabel` - a test that calls the same function
    // the page calls agrees with it however wrong both are. Hiding the control
    // would silently remove a capability the moment the backend grows one.
    expect(actionLabels()).toEqual([FULFILLMENT_ACTION_COPY['close'].label, 'Quarantine parcel']);
    expect(fulfillmentActionLabel('quarantine_parcel')).toBe('Quarantine parcel');
  });

  it('should render the nothing-left sentence when the server offers no action', async () => {
    renderPage({ get: getMock().mockResolvedValue(task({ supportedActions: [] })) });

    expect(
      await screen.findByText(FULFILLMENT_WORK_DETAIL_COPY.actions.nothingLeft),
    ).toBeInTheDocument();
    expect(actionLabels()).toEqual([]);
  });

  it('should say NOTHING to a session that cannot act, even with an empty action set', async () => {
    // THE case the `write.visible` half of the guard exists for, and the only
    // one that distinguishes the two implementations: with it removed this
    // renders "Nothing left to do." to a viewer. That reads as a statement
    // about them rather than about the task - and worse, it is inconsistent,
    // because the very next task with four legal actions (asserted below)
    // renders them the same region empty. A session that cannot act gets one
    // answer for every task, not two that look permission-shaped.
    renderPage({
      sessionAdapter: VIEWER,
      get: getMock().mockResolvedValue(task({ supportedActions: [] })),
    });

    await screen.findByText(/^Order /);
    expect(
      screen.queryByText(FULFILLMENT_WORK_DETAIL_COPY.actions.nothingLeft),
    ).not.toBeInTheDocument();
  });

  it('should render no control and no sentence to a viewer whose task IS actionable', async () => {
    // The other half of that consistency claim: same viewer, four legal
    // actions, same empty region.
    renderPage({
      sessionAdapter: VIEWER,
      get: getMock().mockResolvedValue(
        task({ supportedActions: ['close', 'hold', 'expedite', 'force_cancel'] }),
      ),
    });

    await screen.findByText(/^Order /);
    expect(actionLabels()).toEqual([]);
    expect(
      screen.queryByText(FULFILLMENT_WORK_DETAIL_COPY.actions.nothingLeft),
    ).not.toBeInTheDocument();
  });

  it('should say nothing left to a demo viewer whose task really has nothing left', async () => {
    // A demo read-only viewer has `write.visible` true - the capability is
    // advertised to them - so the sentence is addressed to somebody the page
    // is otherwise offering controls to, and must render. This is what stops
    // the guard above being written as `write.canWrite`, which would suppress
    // it on the deployment that most needs to show the surface working.
    renderPage({
      sessionAdapter: VIEWER,
      demoMode: true,
      get: getMock().mockResolvedValue(task({ supportedActions: [] })),
    });

    expect(
      await screen.findByText(FULFILLMENT_WORK_DETAIL_COPY.actions.nothingLeft),
    ).toBeInTheDocument();
  });

  it('should render a demo viewer’s controls disabled rather than hidden', async () => {
    renderPage({
      sessionAdapter: VIEWER,
      demoMode: true,
      get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })),
    });

    await screen.findByText(/^Order /);
    const close = within(actionsRegion()).getByRole('button', {
      name: FULFILLMENT_ACTION_COPY['close'].label,
    });
    // #1615: the capability is advertised, not pretended away.
    expect(close).toBeDisabled();
  });

  it('should give each hold its own release control when a task carries more than one', async () => {
    renderPage({
      get: getMock().mockResolvedValue(
        task({
          supportedActions: ['release_hold'],
          activeHolds: [hold('hold_1', 'stock-shortfall'), hold('hold_2', 'address-invalid')],
        }),
      ),
    });

    await screen.findByText(/^Order /);
    // Two identical "Release hold" buttons side by side is the defect the
    // mockup names: the accessible name has to say WHICH hold, or an operator
    // releasing the wrong one has no way to have known.
    const labels = actionLabels();
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toEqual([
      `${FULFILLMENT_ACTION_COPY['release_hold'].label} (${holdReasonLabel('stock-shortfall')})`,
      `${FULFILLMENT_ACTION_COPY['release_hold'].label} (${holdReasonLabel('address-invalid')})`,
    ]);
  });

  it('should collapse to one release control when the task carries a single hold', async () => {
    // The complement: with nothing to disambiguate, the qualifier is noise.
    renderPage({
      get: getMock().mockResolvedValue(
        task({
          supportedActions: ['release_hold'],
          activeHolds: [hold('hold_1', 'stock-shortfall')],
        }),
      ),
    });

    await screen.findByText(/^Order /);
    expect(actionLabels()).toEqual([FULFILLMENT_ACTION_COPY['release_hold'].label]);
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
      }),
    );

    renderPage({ get, applyAction });

    await screen.findByText(/^Order /);
    await user.click(
      within(actionsRegion()).getByRole('button', {
        name: FULFILLMENT_ACTION_COPY['close'].label,
      }),
    );

    // (a) Sent ONCE, carrying the token that was drawn - never a fresher one
    // re-read at click time, which would make `version_conflict` unreachable
    // and hand the last writer the win.
    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });
    expect(applyAction).toHaveBeenCalledWith(
      WORK_ID,
      'close',
      expect.objectContaining({ expectedVersion: 3 }),
    );

    // (b) The refresh happened. EXACTLY twice, not `>= 1`: React Query settles
    // either way, so the call count is what goes red if the conflict branch is
    // removed or the invalidation key stops covering the detail read.
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
    });

    // (c) The refreshed action set is what renders, with no second request.
    await waitFor(() => {
      expect(actionLabels()).toEqual([FULFILLMENT_ACTION_COPY['hold'].label]);
    });
    expect(applyAction).toHaveBeenCalledTimes(1);

    // (d) Reported through the SHARED toast - this page has no result slot of
    // its own - and worded for a stale token specifically.
    const toast = await findToastDescription(/Somebody moved this fulfilment task/);
    expect(toast).toBeInTheDocument();
    expect(toast.closest('.toast')).toHaveClass('toast--warning');
  });

  it('should word an action_not_legal differently, and not retry it either', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockRejectedValue(
      new ApiError('not legal', 409, { code: 'action_not_legal', supportedActions: [] }),
    );

    renderPage({
      applyAction,
      get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })),
    });

    await screen.findByText(/^Order /);
    await user.click(
      within(actionsRegion()).getByRole('button', {
        name: FULFILLMENT_ACTION_COPY['close'].label,
      }),
    );

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledTimes(1);
    });

    // Distinguishable from the conflict above on BOTH axes: a different
    // sentence, and `error` rather than `warning` - a stale token is the guard
    // working, an illegal action is not.
    const toast = await findToastDescription(/no longer possible/);
    expect(toast.closest('.toast')).toHaveClass('toast--error');
    expect(screen.queryByText(/Somebody moved this fulfilment task/)).not.toBeInTheDocument();
    expect(applyAction).toHaveBeenCalledTimes(1);
  });

  it('should toast an applied action, through the same surface as the failures', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockResolvedValue(task({ supportedActions: [] }));

    renderPage({
      applyAction,
      get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })),
    });

    await screen.findByText(/^Order /);
    await user.click(
      within(actionsRegion()).getByRole('button', {
        name: FULFILLMENT_ACTION_COPY['close'].label,
      }),
    );

    expect(await findToastDescription(/applied\.$/)).toBeInTheDocument();
  });

  it('should open the confirmation form for an action that needs a field', async () => {
    const user = userEvent.setup();
    const applyAction = applyMock().mockResolvedValue(task());

    renderPage({
      applyAction,
      get: getMock().mockResolvedValue(task({ supportedActions: ['hold'] })),
    });

    await screen.findByText(/^Order /);
    await user.click(
      within(actionsRegion()).getByRole('button', {
        name: FULFILLMENT_ACTION_COPY['hold'].label,
      }),
    );

    // Without the dialog mounted, three of the eight actions this page can
    // offer would be dead controls: the click would open nothing and send
    // nothing, silently.
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
        }),
    );

    renderPage({
      applyAction,
      get: getMock().mockResolvedValue(task({ supportedActions: ['close'] })),
    });

    await screen.findByText(/^Order /);
    expect(actionsRegion()).toHaveAttribute('aria-busy', 'false');

    await user.click(
      within(actionsRegion()).getByRole('button', {
        name: FULFILLMENT_ACTION_COPY['close'].label,
      }),
    );

    // The REGION, not just the button: this page renders one task, so the
    // whole write surface is what is updating. It is the reason the runner
    // exposes `busyTaskId` at all.
    await waitFor(() => {
      expect(actionsRegion()).toHaveAttribute('aria-busy', 'true');
    });

    settle(task({ supportedActions: [] }));
    await waitFor(() => {
      expect(actionsRegion()).toHaveAttribute('aria-busy', 'false');
    });
  });
});
