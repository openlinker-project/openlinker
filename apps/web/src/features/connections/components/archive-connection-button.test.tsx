import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { ArchiveConnectionButton } from './archive-connection-button';

const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
const adminSession = { sessionAdapter: createAuthenticatedSessionAdapter() };

async function openDialog(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Archive' }));
}

describe('ArchiveConnectionButton (#3657)', () => {
  afterEach(cleanup);

  it('should keep the confirm button disabled until the exact connection name is typed', async () => {
    renderWithProviders(<ArchiveConnectionButton connection={disabledConnection} />, adminSession);
    await openDialog();

    const confirm = screen.getByRole('button', { name: 'Archive connection' });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(`Type "${disabledConnection.name}" to confirm`);
    await userEvent.type(input, 'wrong name');
    expect(confirm).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, disabledConnection.name);
    expect(confirm).toBeEnabled();
  });

  it('should archive the connection when confirmed with the right name', async () => {
    const archive = vi.fn().mockResolvedValue({ ...disabledConnection, status: 'archived' });
    const apiClient = createMockApiClient({ connections: { archive } });
    renderWithProviders(<ArchiveConnectionButton connection={disabledConnection} />, {
      apiClient,
      ...adminSession,
    });
    await openDialog();

    await userEvent.type(
      screen.getByLabelText(`Type "${disabledConnection.name}" to confirm`),
      disabledConnection.name
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive connection' }));

    await waitFor(() => expect(archive).toHaveBeenCalledWith(disabledConnection.id));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Archive connection' })).not.toBeInTheDocument()
    );
  });

  it('should keep the dialog open and show the error when archiving fails', async () => {
    const archive = vi.fn().mockRejectedValue(new Error('Connection is active; disable it first'));
    const apiClient = createMockApiClient({ connections: { archive } });
    renderWithProviders(<ArchiveConnectionButton connection={disabledConnection} />, {
      apiClient,
      ...adminSession,
    });
    await openDialog();

    await userEvent.type(
      screen.getByLabelText(`Type "${disabledConnection.name}" to confirm`),
      disabledConnection.name
    );
    await userEvent.click(screen.getByRole('button', { name: 'Archive connection' }));

    expect(await screen.findByText('Connection is active; disable it first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive connection' })).toBeInTheDocument();
  });

  it('should not archive anything when the operator backs out', async () => {
    const archive = vi.fn();
    const apiClient = createMockApiClient({ connections: { archive } });
    renderWithProviders(<ArchiveConnectionButton connection={disabledConnection} />, {
      apiClient,
      ...adminSession,
    });
    await openDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(archive).not.toHaveBeenCalled();
  });
});
