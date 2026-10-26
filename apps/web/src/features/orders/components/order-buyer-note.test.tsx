/**
 * `OrderBuyerNote` unit tests (#3539, mockup M2 `detail` / `long` / `none`).
 *
 * The three wire states are the contract: a string is a note, `null` means the
 * buyer left none, an ABSENT key means unknown. The last two both render
 * nothing, and the difference between them must survive the reader.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrdersApi } from '../api/orders.api';
import type { OrderRecord } from '../api/orders.types';
import { OrderBuyerNote, type OrderBuyerNoteProps } from './order-buyer-note';

const ORDER_ID = 'ol_order_1';
const NOTE = 'Proszę o kubki w kolorze czerwonym. To prezent - bez paragonu w paczce.';
const LONG_NOTE = `${'Dzień dobry, mam kilka próśb dotyczących paczki.\n'.repeat(8)}Dziękuję, Anna`;

const VIEWER: SessionUser = {
  id: 'user_2',
  username: 'viewer',
  email: null,
  role: 'viewer',
  permissions: ['orders:read'],
  analyticsConsent: true,
};

function renderNote(
  order: Partial<OrderBuyerNoteProps['order']> = {},
  opts: { user?: SessionUser; markRead?: OrdersApi['markBuyerNoteRead'] } = {},
) {
  const markBuyerNoteRead =
    opts.markRead ?? vi.fn<OrdersApi['markBuyerNoteRead']>().mockResolvedValue({} as OrderRecord);
  const api = createMockApiClient({
    orders: { markBuyerNoteRead },
    system: { getConfig: vi.fn().mockResolvedValue({ demoMode: false }) },
  });
  renderWithProviders(
    <OrderBuyerNote
      order={{ internalOrderId: ORDER_ID, ...order }}
      channelLabel="Allegro"
      channelPlatform="allegro"
      placedAt="2026-09-25T09:14:00.000Z"
    />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(opts.user) },
  );
  return markBuyerNoteRead;
}


/**
 * jsdom does no layout, so `scrollHeight` / `clientHeight` are always 0. This
 * stands in for a browser whose clamp IS cutting the text off: the hook under
 * test measures, so the measurement is what gets mocked.
 */
function mockClampOverflow(testId: string): () => void {
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.getAttribute('data-testid') === testId ? 200 : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return this.getAttribute('data-testid') === testId ? 80 : 0;
    },
  });
  return () => {
    if (scroll) Object.defineProperty(Element.prototype, 'scrollHeight', scroll);
    if (client) Object.defineProperty(Element.prototype, 'clientHeight', client);
  };
}

afterEach(cleanup);

describe('OrderBuyerNote (#3539)', () => {
  it('should render the note verbatim with who, where and when when a note is present', () => {
    renderNote({ hasBuyerNote: true, buyerNote: NOTE, buyerNoteReadAt: null });

    expect(screen.getByTestId('order-buyer-note-text')).toHaveTextContent(NOTE);
    expect(screen.getByText('Allegro')).toBeInTheDocument();
    expect(screen.getByTestId('order-buyer-note-meta')).toHaveTextContent(
      'Written by the buyer at checkout',
    );
    // The buyer's voice: a section, never an Alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render nothing when the source asserted the buyer left no note', () => {
    renderNote({ hasBuyerNote: false, buyerNote: null });

    expect(screen.queryByTestId('order-buyer-note')).not.toBeInTheDocument();
    expect(screen.queryByText(/no buyer note/i)).not.toBeInTheDocument();
  });

  it('should render nothing when the note is unknown because the key is absent', () => {
    renderNote({ hasBuyerNote: false });

    expect(screen.queryByTestId('order-buyer-note')).not.toBeInTheDocument();
  });

  it('should render nothing for a whitespace-only note', () => {
    renderNote({ hasBuyerNote: true, buyerNote: '   ' });

    expect(screen.queryByTestId('order-buyer-note')).not.toBeInTheDocument();
  });

  it('should say a note exists without showing text when its text is not stored', () => {
    renderNote({ hasBuyerNote: true });

    expect(screen.getByTestId('order-buyer-note')).toHaveAttribute('data-state', 'text-not-stored');
    expect(screen.queryByTestId('order-buyer-note-text')).not.toBeInTheDocument();
  });

  it('should offer the whole note only when the clamp really cuts text off, and reveal it on request', async () => {
    const restore = mockClampOverflow('order-buyer-note-text');
    try {
      renderNote({ hasBuyerNote: true, buyerNote: LONG_NOTE });
      const user = userEvent.setup();

      const text = screen.getByTestId('order-buyer-note-text');
      expect(text).toHaveAttribute('data-clamped', 'true');
      const toggle = await screen.findByRole('button', {
        name: `Show the whole note (${String(LONG_NOTE.length)} characters)`,
      });
      await user.click(toggle);

      expect(text).toHaveAttribute('data-clamped', 'false');
      await user.click(screen.getByRole('button', { name: 'Show less' }));
      expect(text).toHaveAttribute('data-clamped', 'true');
    } finally {
      restore();
    }
  });

  it('should offer no expand control when the text fits the clamp, however long its source', () => {
    // No overflow mocked: layout reports nothing hidden.
    renderNote({ hasBuyerNote: true, buyerNote: LONG_NOTE });

    expect(screen.queryByTestId('order-buyer-note-expand')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-buyer-note-text')).toHaveAttribute('data-clamped', 'false');
  });

  it('should show an unread state and call the read marker when an operator marks it read', async () => {
    const markRead = renderNote({ hasBuyerNote: true, buyerNote: NOTE, buyerNoteReadAt: null });
    const user = userEvent.setup();

    expect(screen.getByTestId('order-buyer-note')).toHaveAttribute('data-state', 'unread');
    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));

    await waitFor(() => {
      expect(markRead).toHaveBeenCalledWith(ORDER_ID);
    });
  });

  it('should show a read state with no mark-as-read control once the note was read', () => {
    renderNote({
      hasBuyerNote: true,
      buyerNote: NOTE,
      buyerNoteReadAt: '2026-09-25T14:31:00.000Z',
      buyerNoteReadByUserId: 'user_9',
    });

    expect(screen.getByTestId('order-buyer-note')).toHaveAttribute('data-state', 'read');
    expect(screen.getByTestId('order-buyer-note-read-state')).toHaveTextContent('Read by user_9');
    expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
  });

  it('should hide the mark-as-read control from a role without orders:write', () => {
    renderNote({ hasBuyerNote: true, buyerNote: NOTE, buyerNoteReadAt: null }, { user: VIEWER });

    expect(screen.getByTestId('order-buyer-note-text')).toBeInTheDocument();
    expect(screen.queryByTestId('order-buyer-note-mark-read')).not.toBeInTheDocument();
  });

  it('should tell the operator when marking read did not save', async () => {
    renderNote(
      { hasBuyerNote: true, buyerNote: NOTE, buyerNoteReadAt: null },
      { markRead: vi.fn<OrdersApi['markBuyerNoteRead']>().mockRejectedValue(new Error('boom')) },
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Mark as read' }));

    expect(await screen.findByTestId('order-buyer-note-error')).toBeInTheDocument();
  });

  it('should say the bench has not read it until a parcel acknowledgement exists', () => {
    renderNote({ hasBuyerNote: true, buyerNote: NOTE, buyerNoteAcknowledgements: [] });
    expect(screen.getByTestId('order-buyer-note-bench-state')).toHaveTextContent(
      'Not marked as read at the bench yet.',
    );
    cleanup();

    renderNote({
      hasBuyerNote: true,
      buyerNote: NOTE,
      buyerNoteAcknowledgements: [
        { workId: 'w1', acknowledgedAt: '2026-09-25T14:31:00.000Z', acknowledgedByUserId: 'user_5' },
      ],
    });
    expect(screen.getByTestId('order-buyer-note-bench-state')).toHaveTextContent(
      'Read at the bench',
    );
  });
});
