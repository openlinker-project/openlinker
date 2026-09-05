/**
 * Bench work list (#2416, `W3b-3`, stories B2–B5, C2, C3)
 *
 * The assertions that matter most here read `textContent`, never a class name:
 * story B4 says state is never carried by colour alone, and a test that looked
 * at a class would pass against a surface that had moved a signal into one.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { BenchWork, BenchWorkList as BenchWorkListData } from '../api/bench-work.types';
import { BenchWorkList } from './bench-work-list';

function work(over: Partial<BenchWork> = {}): BenchWork {
  return {
    workId: 'w-1',
    version: 3,
    orderId: 'ol_order_1',
    orderReference: 'OL-4471',
    buyerName: 'Jan Wiśniewski',
    dispatchByAt: '2026-09-04T16:00:00Z',
    parcelIndex: 1,
    parcelTotal: 2,
    lineCount: 4,
    unitsToVerify: 6,
    state: 'packable',
    holdReason: null,
    holdPlacedAt: null,
    expeditedAt: null,
    supportedActions: ['expedite'],
    ...over,
  };
}

function payload(over: Partial<BenchWorkListData> = {}): BenchWorkListData {
  return {
    works: [work()],
    executorName: 'Warehouse packing',
    routing: { ready: true, reason: null },
    total: 1,
    ...over,
  };
}

/**
 * A packer: a real signed-in user holding NO permissions at all.
 *
 * That is the shipped `ROLE_PERMISSIONS.packer` — deliberately empty — and it is
 * what makes the write-gated control invisible without a second permission
 * being invented for this surface.
 */
const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: [],
  analyticsConsent: true,
} as const;

function mount(data: BenchWorkListData, options: { canWrite?: boolean } = {}) {
  const apiClient = createMockApiClient({
    bench: {
      listWork: vi.fn().mockResolvedValue(data),
      setExpedited: vi.fn().mockResolvedValue(undefined),
    },
  });
  return {
    apiClient,
    ...renderWithProviders(<BenchWorkList now={new Date('2026-09-04T10:00:00Z')} />, {
      apiClient,
      // The query is `enabled` on a signed-in session — the idle lock clears it,
      // and polling an anonymous bench would be firing unauthenticated reads at
      // a terminal nobody is standing at. So every case here signs in.
      sessionAdapter:
        options.canWrite === true
          ? createAuthenticatedSessionAdapter()
          : createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
    }),
  };
}

describe('BenchWorkList (#2416)', () => {
  it('should render a parcel with its reference, buyer and units to verify', async () => {
    mount(payload());

    expect(await screen.findByText('OL-4471')).toBeInTheDocument();
    const row = screen.getByTestId('bench-work-row');
    expect(row.textContent).toContain('Jan Wiśniewski');
    expect(row.textContent).toContain('Parcel 1 of 2');
    expect(row.textContent).toContain('6 units to verify');
  });

  it('should never state or imply that stock is picked or ready (story B2)', async () => {
    mount(payload({ works: [work(), work({ workId: 'w-2', state: 'held', holdReason: 'other' })] }));

    const list = await screen.findByTestId('bench-work-list');
    const text = (list.textContent ?? '').toLowerCase();
    for (const banned of ['picked', 'gathered', 'ready to pack']) {
      expect(text).not.toContain(banned);
    }
  });

  it('should carry state in TEXT, not only in colour (story B4)', async () => {
    mount(
      payload({
        works: [
          work(),
          work({ workId: 'w-2', state: 'held', holdReason: 'address-invalid' }),
          work({ workId: 'w-3', state: 'cancelled' }),
        ],
        total: 3,
      })
    );

    const doNotPack = await screen.findByTestId('bench-section-do-not-pack');
    // Read as text: a class-based assertion would pass against a colour-only
    // signal, which is exactly what B4 forbids.
    expect(doNotPack.textContent).toContain('On hold');
    expect(doNotPack.textContent).toContain('Cancelled');
    expect(doNotPack.textContent).toContain('do not pack');
  });

  it('should place a HELD parcel in the do-not-pack section even though its status reads open', async () => {
    // Nothing writes `status = 'on_hold'`; heldness lives in the hold rows. A
    // surface keying on the status would silently drop every held parcel from
    // the one section whose absence is dangerous.
    mount(payload({ works: [work({ state: 'held', holdReason: 'address-invalid' })] }));

    const doNotPack = await screen.findByTestId('bench-section-do-not-pack');
    expect(within(doNotPack).getByText('OL-4471')).toBeInTheDocument();
    expect(screen.queryByTestId('bench-section-to-pack')).not.toBeInTheDocument();
  });

  it('should distinguish the two empty states (story B3)', async () => {
    const idle = mount(payload({ works: [], total: 0 }));
    expect(await screen.findByTestId('bench-work-empty-idle')).toBeInTheDocument();
    expect(screen.queryByTestId('bench-work-empty-not-routed')).not.toBeInTheDocument();
    idle.unmount();

    mount(
      payload({
        works: [],
        total: 0,
        executorName: null,
        routing: { ready: false, reason: 'no-packing-connection' },
      })
    );
    const notRouted = await screen.findByTestId('bench-work-empty-not-routed');
    expect(notRouted).toBeInTheDocument();
    // B3: the second one names its remedy. Without this the screen states a
    // problem a packer can do nothing about.
    expect(notRouted.textContent?.toLowerCase()).toContain('settings');
  });

  it('should report an unrecognised scan and record NOTHING (story C3)', async () => {
    const { apiClient } = mount(payload());
    await screen.findByTestId('bench-work-list');

    // A scanner burst: fast characters terminated by Enter, with nothing focused.
    for (const char of '5901234123457') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // "Distinctly" (C3) reaches a screen reader as an assertive announcement,
    // not a polite status line — a packer is looking at the box, not the screen.
    // Pins the `tone`, which is what `Alert` derives the role from; #2421 owns
    // the audible half.
    expect(await screen.findByRole('alert')).toHaveTextContent('That scan was not recognised');
    // "records nothing" is the load-bearing half of C3.
    expect(apiClient.bench.setExpedited).not.toHaveBeenCalled();
    expect(apiClient.bench.listWork).toHaveBeenCalledTimes(1);
  });

  it('should have no links out of the flow (story C2)', async () => {
    const { container } = mount(payload());
    await screen.findByTestId('bench-work-list');

    // Leaving is the identity bar's deliberate action (#2413) and nothing else.
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('should filter as the packer types, without asking the server again', async () => {
    const user = userEvent.setup();
    const { apiClient } = mount(
      payload({
        works: [work(), work({ workId: 'w-2', orderReference: 'OL-4480', buyerName: 'Ewa Król' })],
        total: 2,
      })
    );
    // `findBy*`, not `getBy*`: the test QueryClient runs with `gcTime: 0`, so a
    // re-render can briefly re-enter the loading state. Waiting for the field
    // is waiting for the settled surface.
    await user.type(await screen.findByLabelText(/find a parcel/i), '4480');

    await waitFor(() => {
      expect(screen.getAllByTestId('bench-work-row')).toHaveLength(1);
    });
    expect(screen.getByText('OL-4480')).toBeInTheDocument();
    // The search is local: the placeholder promises a surname matches, and
    // sending one to the server would be sending buyer PII in a query string.
    expect(apiClient.bench.listWork).toHaveBeenCalledTimes(1);
  });

  it('should say a search matched nothing rather than showing the empty-bench screen', async () => {
    const user = userEvent.setup();
    mount(payload());
    await user.type(await screen.findByLabelText(/find a parcel/i), 'zzzz');

    expect(await screen.findByTestId('bench-search-no-matches')).toBeInTheDocument();
    // A filtered-out list is not an empty bench, and saying so would tell a
    // packer their work had gone.
    expect(screen.queryByTestId('bench-work-empty-idle')).not.toBeInTheDocument();
  });

  it('should hide the expedite control from a session without write access (story B5)', async () => {
    mount(payload());
    await screen.findByTestId('bench-work-list');

    expect(screen.queryByRole('button', { name: /move to the front/i })).not.toBeInTheDocument();
  });

  it('should let a writer move a parcel to the front, sending the row version it rendered', async () => {
    const user = userEvent.setup();
    const { apiClient } = mount(payload(), { canWrite: true });
    await screen.findByTestId('bench-work-list');

    await user.click(await screen.findByRole('button', { name: /move to the front/i }));

    expect(apiClient.bench.setExpedited).toHaveBeenCalledWith('w-1', 'expedite', 3);
  });

  it('should offer the reverse verb on a parcel already at the front (B5 is reversible)', async () => {
    mount(
      payload({
        works: [
          work({ expeditedAt: '2026-09-04T09:00:00Z', supportedActions: ['release_expedite'] }),
        ],
      }),
      { canWrite: true }
    );

    expect(
      await screen.findByRole('button', { name: /back to deadline order/i })
    ).toBeInTheDocument();
    // And it SAYS it was moved, rather than silently reordering under the packer.
    expect(screen.getByTestId('bench-work-row').textContent).toContain('Moved to the front');
  });

  it('should say when it is showing only part of the work', async () => {
    mount(payload({ total: 900 }));

    expect(await screen.findByText(/more work than fits on this screen/i)).toBeInTheDocument();
  });
});
