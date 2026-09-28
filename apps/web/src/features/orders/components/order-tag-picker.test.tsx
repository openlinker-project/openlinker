/**
 * `OrderTagPicker` unit tests (#3532/#3533, D34).
 *
 * Pins: a non-writer renders nothing at all, the popover lists the
 * workspace vocabulary with the order's own assignment pre-checked,
 * toggling a checkbox calls assign/unassign, and typing an unmatched query
 * offers "Create & add" which creates the tag THEN assigns it to the order.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTagPicker } from './order-tag-picker';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

const ORDER_ID = 'ol_order_1';

const TAGS = [
  { id: 'tag-1', name: 'VIP', color: 'violet' as const, orderCount: 3, createdAt: '', updatedAt: '' },
  { id: 'tag-2', name: 'Gift wrap', color: 'pink' as const, orderCount: 1, createdAt: '', updatedAt: '' },
];

function renderPicker(assignedTagIds: string[] = []) {
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
  );
  return { orders, api };
}

afterEach(cleanup);

describe('OrderTagPicker (#3532/#3533, D34)', () => {
  it('renders nothing when the caller cannot write', () => {
    const api = createMockApiClient({ orders: { listTags: vi.fn().mockResolvedValue(TAGS) } });
    renderWithProviders(
      <OrderTagPicker internalOrderId={ORDER_ID} assignedTagIds={[]} canWrite={false} />,
      { apiClient: api },
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lists the workspace vocabulary with the order\'s own tags pre-checked', async () => {
    const { orders } = renderPicker(['tag-1']);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add tag' }));

    await waitFor(() => { expect(orders.listTags).toHaveBeenCalled(); });
    const vipCheckbox = await screen.findByRole('checkbox', { name: /VIP/ });
    const giftCheckbox = screen.getByRole('checkbox', { name: /Gift wrap/ });
    expect(vipCheckbox).toBeChecked();
    expect(giftCheckbox).not.toBeChecked();
  });

  it('assigns an unchecked tag on click', async () => {
    const { orders } = renderPicker([]);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add tag' }));
    const vipCheckbox = await screen.findByRole('checkbox', { name: /VIP/ });
    await user.click(vipCheckbox);

    expect(orders.assignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-1');
    expect(orders.unassignTag).not.toHaveBeenCalled();
  });

  it('unassigns an already-checked tag on click', async () => {
    const { orders } = renderPicker(['tag-1']);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add tag' }));
    const vipCheckbox = await screen.findByRole('checkbox', { name: /VIP/ });
    await user.click(vipCheckbox);

    expect(orders.unassignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-1');
    expect(orders.assignTag).not.toHaveBeenCalled();
  });

  it('creates a tag from an unmatched query and assigns it to the order (D34)', async () => {
    const { orders } = renderPicker([]);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add tag' }));
    await screen.findByRole('checkbox', { name: /VIP/ });
    await user.type(screen.getByPlaceholderText('Search or create a tag'), 'Fragile');

    const createButton = await screen.findByRole('button', { name: 'Create & add' });
    await user.click(createButton);

    await waitFor(() => {
      expect(orders.createTag).toHaveBeenCalledWith('Fragile', expect.any(String));
    });
    await waitFor(() => {
      expect(orders.assignTag).toHaveBeenCalledWith(ORDER_ID, 'tag-3');
    });
  });
});
