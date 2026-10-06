/**
 * `OrderNotesPanel` unit tests (#3531/#3533, mockup M3).
 *
 * Pins the M3 layout and behaviour: the composer sits ABOVE the thread, the
 * counter tracks the text, "Pin to the top" pins the created note, a failed
 * save keeps the text and offers "Try again", delete asks first and only
 * "Delete note" calls the mutation, a viewer gets the role sentence above the
 * thread and no actions, and the D33 author-or-admin pin rule.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

const VIEWER: SessionUser = {
  id: 'user-4',
  username: 'viewer',
  email: 'viewer@example.com',
  role: 'viewer',
  permissions: ['orders:read'],
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

function renderPanel(
  user: SessionUser,
  notes: OrderNote[],
  overrides: Record<string, unknown> = {},
  channelNames?: string[],
) {
  const orders = {
    listNotes: vi.fn().mockResolvedValue(notes),
    createNote: vi.fn().mockResolvedValue(makeNote({ id: 'note-new', body: 'New one' })),
    pinNote: vi.fn().mockResolvedValue({ ...notes[0], pinnedAt: '2026-09-25T10:05:00.000Z' }),
    unpinNote: vi.fn().mockResolvedValue({ ...notes[0], pinnedAt: null }),
    deleteNote: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(<OrderNotesPanel internalOrderId={ORDER_ID} channelNames={channelNames} />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(user),
  });
  return orders;
}

afterEach(cleanup);

describe('OrderNotesPanel — layout (#3533, mockup M3)', () => {
  it('should render the composer above the notes list when notes exist', async () => {
    renderPanel(AUTHOR, [makeNote()]);

    const list = await screen.findByRole('list', { name: 'Notes' });
    const composer = screen.getByLabelText('New note');
    // DOCUMENT_POSITION_FOLLOWING: the list comes after the composer.
    expect(composer.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(composer).toHaveAttribute('placeholder', 'Add a note for your team');
  });

  it('should name the count and the order channels in the title row when channels are given', async () => {
    renderPanel(AUTHOR, [makeNote()], {}, ['Allegro', 'PrestaShop']);

    expect(await screen.findByRole('heading', { name: 'Notes (1)' })).toBeInTheDocument();
    expect(
      screen.getByText('Only your team sees these. Never sent to Allegro or PrestaShop.'),
    ).toBeInTheDocument();
  });

  it('should show the empty state and still offer the composer when there are no notes', async () => {
    renderPanel(AUTHOR, []);

    expect(await screen.findByText('No notes yet')).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
  });

  it('should count characters as the operator types when composing', async () => {
    renderPanel(AUTHOR, []);
    const user = userEvent.setup();

    await screen.findByText('No notes yet');
    expect(screen.getByText('0 / 2000')).toBeInTheDocument();
    await user.type(screen.getByLabelText('New note'), 'Hello');
    expect(screen.getByText('5 / 2000')).toBeInTheDocument();
  });

  it('should warn about personal data when "Show to packer" is ticked', async () => {
    renderPanel(AUTHOR, []);
    const user = userEvent.setup();

    await screen.findByText('No notes yet');
    await user.click(screen.getByLabelText('Show to packer on the pack bench'));
    expect(
      screen.getByText(
        'Packers see this text on the pack bench. Leave out phone numbers, emails and addresses.',
      ),
    ).toBeInTheDocument();
  });
});

describe('OrderNotesPanel — composer (#3531)', () => {
  it('should pin the created note when "Pin to the top" is ticked', async () => {
    const orders = renderPanel(AUTHOR, []);
    const user = userEvent.setup();

    await screen.findByText('No notes yet');
    await user.type(screen.getByLabelText('New note'), 'Invoice in the box');
    await user.click(screen.getByLabelText('Pin to the top'));
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => {
      expect(orders.createNote).toHaveBeenCalledWith(ORDER_ID, {
        body: 'Invoice in the box',
        showToPacker: false,
      });
    });
    await waitFor(() => { expect(orders.pinNote).toHaveBeenCalledWith(ORDER_ID, 'note-new'); });
  });

  it('should not pin the created note when "Pin to the top" is left unticked', async () => {
    const orders = renderPanel(AUTHOR, []);
    const user = userEvent.setup();

    await screen.findByText('No notes yet');
    await user.type(screen.getByLabelText('New note'), 'Plain note');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    await waitFor(() => { expect(orders.createNote).toHaveBeenCalled(); });
    expect(orders.pinNote).not.toHaveBeenCalled();
  });

  it('should keep the text and offer "Try again" when saving fails', async () => {
    const createNote = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network down.'))
      .mockResolvedValueOnce(makeNote({ id: 'note-new' }));
    const orders = renderPanel(AUTHOR, [], { createNote });
    const user = userEvent.setup();

    await screen.findByText('No notes yet');
    await user.type(screen.getByLabelText('New note'), 'Keep me');
    await user.click(screen.getByRole('button', { name: 'Add note' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Note not saved')).toBeInTheDocument();
    expect(within(alert).getByText(/Your text is still in the box above\./)).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toHaveValue('Keep me');

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => { expect(orders.createNote).toHaveBeenCalledTimes(2); });
  });
});

describe('OrderNotesPanel — delete (#3533)', () => {
  it('should ask for confirmation and only delete when "Delete note" is clicked', async () => {
    const orders = renderPanel(AUTHOR, [makeNote()]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete this note?' });
    expect(within(dialog).getByText('marta.nowak')).toBeInTheDocument();
    expect(orders.deleteNote).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Keep note' }));
    expect(orders.deleteNote).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete note' }),
    );
    await waitFor(() => { expect(orders.deleteNote).toHaveBeenCalledWith(ORDER_ID, 'note-1'); });
  });
});

describe('OrderNotesPanel — viewer (#3533, mockup M3 `viewer`)', () => {
  it('should state the role needed above the list and offer no actions when the caller is a viewer', async () => {
    renderPanel(VIEWER, [makeNote()]);

    const list = await screen.findByRole('list', { name: 'Notes' });
    const sentence = screen.getByText(
      'You can read notes. Adding or changing them needs the operator or admin role.',
    );
    expect(sentence.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText('New note')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OrderNotesPanel — pin action (#3531)', () => {
  it('should offer Pin when the caller authored the note', async () => {
    renderPanel(AUTHOR, [makeNote()]);
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('should offer Pin when the caller is an admin who did not author the note', async () => {
    renderPanel(ADMIN, [makeNote()]);
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('should offer no Pin action when the caller is a non-author operator', async () => {
    renderPanel(OTHER_OPERATOR, [makeNote()]);
    await screen.findByText('Fragile — pack with extra care');
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull();
  });

  it('should call pinNote with the note id when Pin is clicked', async () => {
    const orders = renderPanel(AUTHOR, [makeNote()]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Pin' }));

    await waitFor(() => { expect(orders.pinNote).toHaveBeenCalledWith(ORDER_ID, 'note-1'); });
  });

  it('should show "Pinned" and offer Unpin when the note is already pinned', async () => {
    const orders = renderPanel(AUTHOR, [makeNote({ pinnedAt: '2026-09-25T10:05:00.000Z' })]);
    const user = userEvent.setup();

    expect(await screen.findByText('Pinned')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unpin' }));

    await waitFor(() => { expect(orders.unpinNote).toHaveBeenCalledWith(ORDER_ID, 'note-1'); });
  });
});
