/**
 * `BulkTagPopover` unit tests (#3532/#3533, mockup M3 `bulk`).
 *
 * Pins: the menu is labelled with the selection size; a tag's "N of M has it"
 * hint appears only when some selected order already carries it and a tag
 * every selected order has is disabled ("All have it"); choosing a tag calls
 * bulk-assign with every selected id and reports the result as a toast;
 * failures surface as an error toast; "Manage tags" is admin-only.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkTagPopover } from './bulk-tag-popover';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastDescription,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import type { SessionUser } from '../../../shared/auth/session.types';
import type { OrderRecord } from '../api/orders.types';

const TAGS = [
  { id: 'tag-1', name: 'VIP', color: 'violet' as const, orderCount: 3, createdAt: '', updatedAt: '' },
  { id: 'tag-2', name: 'Fragile', color: 'amber' as const, orderCount: 3, createdAt: '', updatedAt: '' },
  { id: 'tag-3', name: 'B2B', color: 'blue' as const, orderCount: 3, createdAt: '', updatedAt: '' },
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

function makeOrder(id: string, tagIds: string[]): OrderRecord {
  return {
    internalOrderId: id,
    sourceConnectionId: 'conn-1',
    orderSnapshot: {},
    syncStatus: [],
    recordStatus: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tagIds,
  } as unknown as OrderRecord;
}

const SELECTED = [
  makeOrder('ol_order_1', ['tag-1', 'tag-3']),
  makeOrder('ol_order_2', ['tag-3']),
  makeOrder('ol_order_3', ['tag-3']),
];

function renderMenu(
  orders: Record<string, unknown>,
  selectedOrders: readonly OrderRecord[] = SELECTED,
  sessionUser: SessionUser = OPERATOR,
) {
  const api = createMockApiClient({ orders: { listTags: vi.fn().mockResolvedValue(TAGS), ...orders } });
  renderWithProviders(<BulkTagPopover selectedOrders={selectedOrders} />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(sessionUser),
  });
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Tags' }));
  await screen.findByRole('menuitem', { name: /VIP/ });
}

afterEach(cleanup);

describe('BulkTagPopover (#3532/#3533)', () => {
  it('should label the menu with the number of selected orders when opened', async () => {
    renderMenu({});
    const user = userEvent.setup();
    await openMenu(user);

    expect(screen.getByText('Add tag to 3 orders')).toBeInTheDocument();
  });

  it('should show the "has it" hint only when some selected orders carry the tag', async () => {
    renderMenu({});
    const user = userEvent.setup();
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: /VIP/ })).toHaveTextContent('1 of 3 has it');
    expect(screen.getByRole('menuitem', { name: /Fragile/ })).not.toHaveTextContent(/has it|have it/);
    const b2b = screen.getByRole('menuitem', { name: /B2B/ });
    expect(b2b).toHaveTextContent('All have it');
    expect(b2b).toHaveAttribute('aria-disabled', 'true');
  });

  it('should bulk-assign to every selected order and report the result as a toast', async () => {
    const bulkAssignTag = vi.fn().mockResolvedValue({ tagId: 'tag-1', added: 2, alreadyTagged: 1 });
    renderMenu({ bulkAssignTag });
    const user = userEvent.setup();
    await openMenu(user);

    await user.click(screen.getByRole('menuitem', { name: /VIP/ }));

    await waitFor(() => {
      expect(bulkAssignTag).toHaveBeenCalledWith('tag-1', ['ol_order_1', 'ol_order_2', 'ol_order_3']);
    });
    expect(await findToastTitle('Tag added')).toBeInTheDocument();
    expect(await findToastDescription('VIP added to 2 orders. 1 already had it.')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('should surface a failure as an error toast when bulk-assign fails', async () => {
    const bulkAssignTag = vi.fn().mockRejectedValue(new Error('Tag not found'));
    renderMenu({ bulkAssignTag });
    const user = userEvent.setup();
    await openMenu(user);

    await user.click(screen.getByRole('menuitem', { name: /Fragile/ }));

    expect(await findToastTitle('Tag not added')).toBeInTheDocument();
    expect(await findToastDescription('Tag not found')).toBeInTheDocument();
  });

  it('should offer "Manage tags" only when the caller is an admin', async () => {
    renderMenu({}, SELECTED, ADMIN);
    const user = userEvent.setup();
    await openMenu(user);

    expect(screen.getByRole('menuitem', { name: 'Manage tags' })).toHaveAttribute(
      'href',
      '/settings/order-tags',
    );
  });

  it('should not offer "Manage tags" when the caller is an operator', async () => {
    renderMenu({});
    const user = userEvent.setup();
    await openMenu(user);

    expect(screen.queryByRole('menuitem', { name: 'Manage tags' })).toBeNull();
  });
});
