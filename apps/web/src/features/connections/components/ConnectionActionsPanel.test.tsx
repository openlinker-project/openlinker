import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { ConnectionActionsPanel } from './ConnectionActionsPanel';

describe('ConnectionActionsPanel', () => {
  afterEach(cleanup);

  it('renders edit and disable actions for an active connection', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('hides disable button when connection is already disabled', () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />);

    expect(screen.getByRole('link', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('links edit action to the correct URL', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    const editLink = screen.getByRole('link', { name: 'Edit' });
    expect(editLink).toHaveAttribute('href', `/connections/${sampleConnection.id}/edit`);
  });

  it('renders "Sync now" button for PrestaShop (ProductMaster-capable) connections', () => {
    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />);

    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument();
  });

  it('hides "Sync now" button for non-ProductMaster platforms', () => {
    const allegroConnection = { ...sampleConnection, platformType: 'allegro' as const };
    renderWithProviders(<ConnectionActionsPanel connection={allegroConnection} />);

    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('hides "Sync now" button when the connection is disabled', () => {
    const disabledConnection = { ...sampleConnection, status: 'disabled' as const };
    renderWithProviders(<ConnectionActionsPanel connection={disabledConnection} />);

    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('enqueues master.product.syncAll when "Sync now" is clicked', async () => {
    const enqueue = vi.fn().mockResolvedValue({ jobId: 'job-xyz', status: 'queued' });
    const apiClient = createMockApiClient({ syncJobs: { enqueue } });

    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      expect(enqueue).toHaveBeenCalledTimes(1);
    });
    const input = enqueue.mock.calls[0][0] as {
      connectionId: string;
      jobType: string;
      payload: { schemaVersion: number };
      idempotencyKey: string;
    };
    expect(input.connectionId).toBe(sampleConnection.id);
    expect(input.jobType).toBe('master.product.syncAll');
    expect(input.payload).toEqual({ schemaVersion: 1 });
    expect(input.idempotencyKey).toMatch(
      new RegExp(`^manual:${sampleConnection.id}:product:syncAll:\\d+$`),
    );
  });

  it('surfaces an error alert when the enqueue mutation fails', async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error('queue offline'));
    const apiClient = createMockApiClient({ syncJobs: { enqueue } });

    renderWithProviders(<ConnectionActionsPanel connection={sampleConnection} />, { apiClient });

    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));

    expect(await screen.findByText('Unable to start product sync')).toBeInTheDocument();
    expect(screen.getByText('queue offline')).toBeInTheDocument();
  });
});
