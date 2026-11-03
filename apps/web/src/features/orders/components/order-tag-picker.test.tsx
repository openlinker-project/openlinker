/**
 * `OrderTagPicker` unit tests (#3532/#3533, D34, mockup M3).
 *
 * Pins: a non-writer renders nothing; the list is a `role="group"` named
 * "Tags" with the order's own assignment pre-checked; ticking assigns /
 * unticking unassigns; ↓/↑ move between rows and Enter toggles; an unmatched
 * query puts `+ Create “x”` FIRST and Enter in the search box creates the tag
 * THEN assigns it; "Manage tags" is an admin-only footer link.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTagPicker } from './order-tag-picker';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';

const ORDER_ID = 'ol_order_1';

const TAGS = [
  { id: 'tag-1', name: 'VIP', color: 'violet' as const, orderCount: 3, createdAt: '', updatedAt: '' },
  { id: 'tag-2', name: 'Gift wrap', color: 'pink' as const, orderCount: 1, createdAt: '', updatedAt: '' },
];

const ADMIN: SessionUser = {
  id: 'user-admin',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const OPERATOR: SessionUser = {
  id: 'user-op',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

function renderPicker(assignedTagIds: string[] = [], sessionUser: SessionUser = OPERATOR) {
  const orders = {
    listTags: vi.fn().mockResolvedValue(TAGS),
    assignTag: vi.fn().mockResolvedValue(undefined),
    unassignTag: vi.fn().mockResolvedValue(undefined),
    createTag: vi.fn().mockResolvedValue({
      id: 'tag-3',
      name: 'Fragile',
      color: 'amber',
      orderCount: 0,
      createdAt: '',
      updatedAt: '',
    }),
  };
  const api = createMockApiClient({ orders });
  renderWithProviders(
    <OrderTagPicker internalOrderId={ORDER_ID} assignedTagIds={assignedTagIds} canWrite />,
    { apiClient: api, sessionAdapter: createAuthenticatedSessionAdapter(sessionUser) },
  );
  return { orders, api };
}

async function openPicker(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '+ Add tag' }));
  await screen.findByRole('checkbox', { name: /VIP/ });
}

afterEach(cleanup);

describe('OrderTagPicker (#3532/#3533, D34)', () => {
  it('should render nothing when the caller cannot write', () => {
    const api = createMockApiClient({ orders: { listTags: vi.fn().mockResolvedValue(TAGS) } });
    renderWithProviders(
      <OrderTagPicker internalOrderId={ORDER_ID} assignedTagIds={[]} canWrite={false} />,
      { apiClient: api },
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should list the vocabulary in a "Tags" group with the order\'s own tags pre-checked', async () => {
    renderPicker(['tag-1']);
    const user = userEvent.setup();
    await openPicker(user);

    const group = screen.getByRole('group', { name: 'Tags' });
    expect(within(group).getByRole('checkbox', { name: /VIP/ })).toBeChecked();
    expect(within(group).getByRole('checkbox', { name: /Gift wrap/ })).not.toBeChecked();
    expect(screen.getByPlaceholderText('Find or create a tag')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('should assign an unchecked tag when it is clicked', async () => {
    const { orders } = renderPicker([]);
    const user = userEvent.setup();
    await openPicker(user);

    await user.click(screen.getByRole('checkbox', { name: /VIP/ }));

    await waitFor(() => { expect(orders.assignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-1'); });
    expect(orders.unassignTag).not.toHaveBeenCalled();
  });

  it('should unassign an already-checked tag when it is clicked', async () => {
    const { orders } = renderPicker(['tag-1']);
    const user = userEvent.setup();
    await openPicker(user);

    await user.click(screen.getByRole('checkbox', { name: /VIP/ }));

    await waitFor(() => { expect(orders.unassignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-1'); });
    expect(orders.assignTag).not.toHaveBeenCalled();
  });

  it('should move between rows with the arrow keys and toggle with Enter', async () => {
    const { orders } = renderPicker([]);
    const user = userEvent.setup();
    await openPicker(user);

    const search = screen.getByPlaceholderText('Find or create a tag');
    search.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('checkbox', { name: /VIP/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('checkbox', { name: /Gift wrap/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => { expect(orders.assignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-2'); });

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(search).toHaveFocus();
  });

  it('should put the Create row first and create then assign when Enter is pressed (D34)', async () => {
    const { orders } = renderPicker([]);
    const user = userEvent.setup();
    await openPicker(user);

    await user.type(screen.getByPlaceholderText('Find or create a tag'), 'Fragile');

    const group = screen.getByRole('group', { name: 'Tags' });
    const createRow = within(group).getByRole('button', { name: '+ Create “Fragile”' });
    expect(group.firstElementChild).toBe(createRow);

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(orders.createTag).toHaveBeenCalledWith('Fragile', expect.any(String));
    });
    await waitFor(() => { expect(orders.assignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-3'); });
    expect(await findToastTitle('Tag created and added')).toBeInTheDocument();
  });

  it('should not offer Create when the query matches an existing tag exactly', async () => {
    renderPicker([]);
    const user = userEvent.setup();
    await openPicker(user);

    await user.type(screen.getByPlaceholderText('Find or create a tag'), 'vip');
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });

  it('should show the server refusal in the picker when creating fails', async () => {
    const { orders } = renderPicker([]);
    orders.createTag.mockRejectedValueOnce(new Error('The workspace already has 50 tags.'));
    const user = userEvent.setup();
    await openPicker(user);

    await user.type(screen.getByPlaceholderText('Find or create a tag'), 'New');
    await user.click(screen.getByRole('button', { name: '+ Create “New”' }));

    expect(await screen.findByText('The workspace already has 50 tags.')).toBeInTheDocument();
    expect(orders.assignTag).not.toHaveBeenCalled();
  });

  it('should show "Manage tags" only when the caller is an admin', async () => {
    renderPicker([], ADMIN);
    const user = userEvent.setup();
    await openPicker(user);

    expect(screen.getByRole('link', { name: 'Manage tags' })).toHaveAttribute(
      'href',
      '/settings/order-tags',
    );
    expect(screen.getByText('Saved as you tick')).toBeInTheDocument();
  });

  it('should hide "Manage tags" when the caller is an operator', async () => {
    renderPicker([], OPERATOR);
    const user = userEvent.setup();
    await openPicker(user);

    expect(screen.queryByRole('link', { name: 'Manage tags' })).toBeNull();
    expect(screen.getByText('Saved as you tick')).toBeInTheDocument();
  });
});
