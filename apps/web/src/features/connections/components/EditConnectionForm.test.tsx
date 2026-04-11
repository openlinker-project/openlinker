import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { EditConnectionForm } from './EditConnectionForm';

describe('EditConnectionForm', () => {
  afterEach(cleanup);

  it('renders pre-filled form fields from the connection', () => {
    renderWithProviders(<EditConnectionForm connection={sampleConnection} />);

    expect(screen.getByDisplayValue(sampleConnection.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(sampleConnection.platformType)).toBeInTheDocument();
    expect(screen.getByDisplayValue(sampleConnection.credentialsRef)).toBeInTheDocument();
  });

  it('shows platform type and credentials ref as disabled fields', () => {
    renderWithProviders(<EditConnectionForm connection={sampleConnection} />);

    const platformInput = screen.getByDisplayValue(sampleConnection.platformType);
    const credentialsInput = screen.getByDisplayValue(sampleConnection.credentialsRef);

    expect(platformInput).toBeDisabled();
    expect(credentialsInput).toBeDisabled();
  });

  it('submits the update with changed values', async () => {
    const updateFn = vi.fn().mockResolvedValue(sampleConnection);
    const apiClient = createMockApiClient({
      connections: { update: updateFn, getById: vi.fn().mockResolvedValue(sampleConnection) },
    });

    renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });

    const nameInput = screen.getByDisplayValue(sampleConnection.name);
    fireEvent.change(nameInput, { target: { value: 'Updated Store' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(updateFn).toHaveBeenCalledWith(sampleConnection.id, expect.objectContaining({
        name: 'Updated Store',
      }));
    });
  });

  it('shows validation errors in summary after submit attempt', async () => {
    const connectionWithBadConfig = { ...sampleConnection, config: {}, name: '' };
    renderWithProviders(<EditConnectionForm connection={connectionWithBadConfig} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    const errors = await screen.findAllByText('Connection name is required');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('shows API error when update fails', async () => {
    const apiClient = createMockApiClient({
      connections: {
        update: vi.fn().mockRejectedValue(new Error('Server error')),
        getById: vi.fn().mockResolvedValue(sampleConnection),
      },
    });

    renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Server error')).toBeInTheDocument();
  });
});
