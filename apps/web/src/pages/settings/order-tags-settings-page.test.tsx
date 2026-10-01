/**
 * `OrderTagsSettingsPage` unit tests (#3532/#3533, D34, mockup M3 `tags`).
 *
 * Pins: a non-admin sees only the "needs the admin role" message; an admin
 * sees the table with the colour NAME, the live order count and the
 * "N of 50 tags used" line; the "New tag" card creates a tag with the chosen
 * colour and previews it live; Edit -> Save renames; Delete opens a confirm
 * naming the affected order count and only "Delete tag" calls the mutation.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTagsSettingsPage } from './order-tags-settings-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../test/test-utils';
import type { SessionUser } from '../../shared/auth/session.types';

const OPERATOR: SessionUser = {
  id: 'user_2',
  username: 'operator',
  email: 'operator@example.com',
  role: 'operator',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write'],
  analyticsConsent: true,
};

const TAGS = [
  {
    id: 'tag-1',
    name: 'VIP',
    color: 'violet' as const,
    orderCount: 42,
    createdAt: '2026-03-12T09:00:00.000Z',
    updatedAt: '2026-03-12T09:00:00.000Z',
  },
];

function renderPage(orders: Record<string, unknown>, sessionUser: SessionUser = ADMIN) {
  const api = createMockApiClient({ orders: { listTags: vi.fn().mockResolvedValue(TAGS), ...orders } });
  renderWithProviders(<OrderTagsSettingsPage />, {
    apiClient: api,
    sessionAdapter: createAuthenticatedSessionAdapter(sessionUser),
  });
}

afterEach(cleanup);

describe('OrderTagsSettingsPage (#3532/#3533, D34)', () => {
  it('should tell a non-admin the page needs the admin role and render no table', async () => {
    renderPage({}, OPERATOR);

    expect(await screen.findByText('This page needs the admin role.')).toBeInTheDocument();
    expect(screen.queryByText('VIP')).toBeNull();
  });

  it('should list tags with the colour name, live order count and usage when the caller is an admin', async () => {
    renderPage({});

    expect(await screen.findByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('Violet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '42' })).toHaveAttribute('href', '/orders?tag=tag-1');
    expect(screen.getByText('1 of 50 tags used.')).toBeInTheDocument();
  });

  it('should create a tag with the chosen colour from the New tag card', async () => {
    const createTag = vi.fn().mockResolvedValue({ ...TAGS[0], id: 'tag-2', name: 'Courier 12:00' });
    renderPage({ createTag });
    const user = userEvent.setup();

    await screen.findByText('VIP');
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    const card = screen.getByRole('form', { name: 'New tag' });
    await user.type(within(card).getByLabelText('Name'), 'Courier 12:00');
    await user.click(within(card).getByRole('radio', { name: 'Teal' }));

    const preview = within(card).getByText('Courier 12:00').closest('.order-tag');
    expect(preview).toHaveAttribute('data-tag-color', 'teal');
    expect(within(card).getByText('13 / 32')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Create tag' }));
    await waitFor(() => { expect(createTag).toHaveBeenCalledWith('Courier 12:00', 'teal'); });
    expect(await findToastTitle('Tag created')).toBeInTheDocument();
  });

  it('should rename a tag via Edit -> Save', async () => {
    const updateTag = vi.fn().mockResolvedValue({ ...TAGS[0], name: 'VIP Buyers' });
    renderPage({ updateTag });
    const user = userEvent.setup();

    await screen.findByText('VIP');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'VIP Buyers');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledWith('tag-1', expect.objectContaining({ name: 'VIP Buyers' }));
    });
  });

  it('should delete a tag only after the confirm dialog naming the order count', async () => {
    const deleteTag = vi.fn().mockResolvedValue(undefined);
    renderPage({ deleteTag });
    const user = userEvent.setup();

    await screen.findByText('VIP');
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete tag “VIP”?' });
    expect(within(dialog).getByText('42')).toBeInTheDocument();
    expect(deleteTag).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Keep tag' }));
    expect(deleteTag).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete tag' }),
    );
    await waitFor(() => { expect(deleteTag).toHaveBeenCalledWith('tag-1'); });
  });
});
