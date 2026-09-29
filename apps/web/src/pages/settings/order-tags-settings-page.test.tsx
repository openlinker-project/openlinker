/**
 * `OrderTagsSettingsPage` unit tests (#3532/#3533, D34).
 *
 * Pins: a non-admin sees only the "needs the admin role" message (no table,
 * no writes reachable), an admin sees the tag table with its live order
 * count, Edit -> Save calls the rename/recolor mutation, and Delete asks
 * for confirmation naming the affected order count before calling the
 * delete mutation.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTagsSettingsPage } from './order-tags-settings-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../test/test-utils';
import type { SessionUser } from '../../shared/auth/session.types';

const VIEWER: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const TAGS = [
  { id: 'tag-1', name: 'VIP', color: 'violet' as const, orderCount: 17, createdAt: '', updatedAt: '' },
];

afterEach(cleanup);

describe('OrderTagsSettingsPage (#3532/#3533, D34)', () => {
  it('tells a non-admin the page needs the admin role, and renders no table', async () => {
    const orders = { listTags: vi.fn().mockResolvedValue(TAGS) };
    renderWithProviders(<OrderTagsSettingsPage />, {
      apiClient: createMockApiClient({ orders }),
      sessionAdapter: createAuthenticatedSessionAdapter(VIEWER),
    });

    expect(await screen.findByText('This page needs the admin role.')).toBeInTheDocument();
    expect(screen.queryByText('VIP')).toBeNull();
  });

  it('lists tags with their live order count for an admin', async () => {
    const orders = { listTags: vi.fn().mockResolvedValue(TAGS) };
    renderWithProviders(<OrderTagsSettingsPage />, { apiClient: createMockApiClient({ orders }) });

    expect(await screen.findByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
  });

  it('renames a tag via Edit -> Save', async () => {
    const orders = {
      listTags: vi.fn().mockResolvedValue(TAGS),
      updateTag: vi.fn().mockResolvedValue({ ...TAGS[0], name: 'VIP Buyers' }),
    };
    const api = createMockApiClient({ orders });
    renderWithProviders(<OrderTagsSettingsPage />, { apiClient: api });
    const user = userEvent.setup();

    await screen.findByText('VIP');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Tag name');
    await user.clear(nameInput);
    await user.type(nameInput, 'VIP Buyers');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(orders.updateTag).toHaveBeenCalledWith(
        'tag-1',
        expect.objectContaining({ name: 'VIP Buyers' }),
      );
    });
  });

  it('deletes a tag only after confirming, naming the affected order count', async () => {
    const orders = {
      listTags: vi.fn().mockResolvedValue(TAGS),
      deleteTag: vi.fn().mockResolvedValue(undefined),
    };
    const api = createMockApiClient({ orders });
    renderWithProviders(<OrderTagsSettingsPage />, { apiClient: api });
    const user = userEvent.setup();

    await screen.findByText('VIP');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText(/Removes it from 17 orders/)).toBeInTheDocument();
    expect(orders.deleteTag).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => { expect(orders.deleteTag).toHaveBeenCalledWith('tag-1'); });
  });
});
