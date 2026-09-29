/**
 * `OrderNotesPanel` pin-action unit tests (#3531 pin recovery pass).
 *
 * Pins: the author (or an admin) sees a Pin/Unpin action, matching D33's
 * delete shape; a non-author non-admin sees neither; clicking Pin/Unpin
 * calls the matching mutation with the note's id; and a note already
 * pinned shows the "Pinned" badge and offers "Unpin" instead of "Pin".
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderNotesPanel } from './order-notes-panel';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrderNote } from '../api/orders.types';

const ORDER_ID = 'ol_order_1';

const AUTHOR: SessionUser = {
  id: 'user-1',
  username: 'marta.nowak',
  email: 'marta@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const OTHER_OPERATOR: SessionUser = {
  id: 'user-2',
  username: 'tomasz.zielinski',
  email: 'tomasz@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const ADMIN: SessionUser = {
  id: 'user-3',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

function makeNote(overrides: Partial<OrderNote> = {}): OrderNote {
  return {
    id: 'note-1',
    internalOrderId: ORDER_ID,
    authorUserId: AUTHOR.id,
    authorUsername: AUTHOR.username,
    body: 'Fragile — pack with extra care',
    showToPacker: false,
    editedAt: null,
    pinnedAt: null,
    createdAt: '2026-09-25T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(user: SessionUser, notes: OrderNote[]) {
  const orders = {
    listNotes: vi.fn().mockResolvedValue(notes),
    pinNote: vi.fn().mockResolvedValue({ ...notes[0], pinnedAt: '2026-09-25T10:05:00.000Z' }),
    unpinNote: vi.fn().mockResolvedValue({ ...notes[0], pinnedAt: null }),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(<OrderNotesPanel internalOrderId={ORDER_ID} />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(user),
  });
  return orders;
}

afterEach(cleanup);

describe('OrderNotesPanel — pin action (#3531)', () => {
  it('offers Pin to the note\'s own author', async () => {
    renderPanel(AUTHOR, [makeNote()]);
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('offers Pin to an admin who did not author the note', async () => {
    renderPanel(ADMIN, [makeNote()]);
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('offers no Pin action to a non-author, non-admin operator', async () => {
    renderPanel(OTHER_OPERATOR, [makeNote()]);
    await screen.findByText('Fragile — pack with extra care');
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull();
  });

  it('calls pinNote with the note id when Pin is clicked', async () => {
    const orders = renderPanel(AUTHOR, [makeNote()]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Pin' }));

    await waitFor(() => { expect(orders.pinNote).toHaveBeenCalledWith(ORDER_ID, 'note-1'); });
  });

  it('shows "Pinned" and offers Unpin for an already-pinned note', async () => {
    const orders = renderPanel(AUTHOR, [makeNote({ pinnedAt: '2026-09-25T10:05:00.000Z' })]);
    const user = userEvent.setup();

    expect(await screen.findByText('Pinned')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unpin' }));

    await waitFor(() => { expect(orders.unpinNote).toHaveBeenCalledWith(ORDER_ID, 'note-1'); });
  });
});
