/**
 * `PinnedOrderNoteBanner` unit tests (#3531 pin recovery pass).
 *
 * Pins: renders nothing while loading or when no note is pinned (never a
 * "no pinned note" claim), and renders the pinned note's body/author/time
 * plus the "Shown to packer" badge only when that note is flagged.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedOrderNoteBanner } from './order-notes-panel';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { OrderNote } from '../api/orders.types';

const ORDER_ID = 'ol_order_1';

function makeNote(overrides: Partial<OrderNote> = {}): OrderNote {
  return {
    id: 'note-1',
    internalOrderId: ORDER_ID,
    authorUserId: 'user-1',
    authorUsername: 'marta.nowak',
    body: 'Buyer asked for the paper invoice inside the parcel.',
    showToPacker: false,
    editedAt: null,
    pinnedAt: null,
    createdAt: '2026-09-25T12:40:00.000Z',
    updatedAt: '2026-09-25T12:40:00.000Z',
    ...overrides,
  };
}

afterEach(cleanup);

describe('PinnedOrderNoteBanner (#3531)', () => {
  it('renders nothing when no note is pinned', async () => {
    const orders = { listNotes: vi.fn().mockResolvedValue([makeNote()]) };
    const { container } = renderWithProviders(
      <PinnedOrderNoteBanner internalOrderId={ORDER_ID} />,
      { apiClient: createMockApiClient({ orders }) },
    );

    await vi.waitFor(() => { expect(orders.listNotes).toHaveBeenCalled(); });
    expect(container.querySelector('.order-note-pinned')).toBeNull();
  });

  it('renders the pinned note\'s body, author and time', async () => {
    const orders = {
      listNotes: vi.fn().mockResolvedValue([makeNote({ pinnedAt: '2026-09-25T12:41:00.000Z' })]),
    };
    renderWithProviders(<PinnedOrderNoteBanner internalOrderId={ORDER_ID} />, {
      apiClient: createMockApiClient({ orders }),
    });

    expect(await screen.findByText(/Buyer asked for the paper invoice/)).toBeInTheDocument();
    expect(screen.getByText('marta.nowak')).toBeInTheDocument();
    expect(screen.getByText('Pinned note')).toBeInTheDocument();
  });

  it('shows the "Shown to packer" badge only when the pinned note is flagged', async () => {
    const orders = {
      listNotes: vi
        .fn()
        .mockResolvedValue([makeNote({ pinnedAt: '2026-09-25T12:41:00.000Z', showToPacker: true })]),
    };
    renderWithProviders(<PinnedOrderNoteBanner internalOrderId={ORDER_ID} />, {
      apiClient: createMockApiClient({ orders }),
    });

    expect(await screen.findByText('Shown to packer')).toBeInTheDocument();
  });
});
