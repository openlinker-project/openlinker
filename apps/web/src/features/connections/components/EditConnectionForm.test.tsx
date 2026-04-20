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
    expect(screen.getByText('Rotate webservice key')).toBeInTheDocument();
  });

  it('shows platform type as disabled and credentials behind a rotate button', () => {
    renderWithProviders(<EditConnectionForm connection={sampleConnection} />);

    const platformInput = screen.getByDisplayValue(sampleConnection.platformType);
    expect(platformInput).toBeDisabled();
    expect(screen.getByText('Rotate webservice key')).toBeInTheDocument();
    // The internal credential reference must not be exposed in the UI.
    expect(screen.queryByDisplayValue('db:')).not.toBeInTheDocument();
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

  describe('structured PrestaShop inputs + raw JSON toggle', () => {
    it('renders Shop URL / Shop ID inputs for a PrestaShop connection', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      expect(screen.getByLabelText('Shop URL')).toHaveValue('https://example.com');
      expect(screen.getByLabelText('Shop ID (optional)')).toHaveValue('');
    });

    it('keeps the raw JSON textarea hidden by default and reveals it via the toggle', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      expect(screen.queryByLabelText('Config JSON')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Show raw config JSON' }));

      expect(screen.getByLabelText('Config JSON')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Hide raw config JSON' })).toBeInTheDocument();
    });

    it('syncs structured Shop URL edits into the underlying Config JSON payload', async () => {
      const updateFn = vi.fn().mockResolvedValue(sampleConnection);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />, { apiClient });

      fireEvent.change(screen.getByLabelText('Shop URL'), {
        target: { value: 'https://new.example.com' },
      });
      fireEvent.change(screen.getByLabelText('Shop ID (optional)'), {
        target: { value: '7' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          sampleConnection.id,
          expect.objectContaining({
            config: { baseUrl: 'https://new.example.com', shopId: '7' },
          }),
        );
      });
    });

    it('preserves unknown config keys when structured inputs are edited', async () => {
      const connectionWithExtras = {
        ...sampleConnection,
        config: { baseUrl: 'https://example.com', customFlag: true, nested: { ok: 1 } },
      };
      const updateFn = vi.fn().mockResolvedValue(connectionWithExtras);
      const apiClient = createMockApiClient({ connections: { update: updateFn } });
      renderWithProviders(<EditConnectionForm connection={connectionWithExtras} />, { apiClient });

      fireEvent.change(screen.getByLabelText('Shop URL'), {
        target: { value: 'https://rotated.example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => {
        expect(updateFn).toHaveBeenCalledWith(
          sampleConnection.id,
          expect.objectContaining({
            config: {
              baseUrl: 'https://rotated.example.com',
              customFlag: true,
              nested: { ok: 1 },
            },
          }),
        );
      });
    });

    it('locks the structured inputs and surfaces a warning when raw JSON is invalid', () => {
      renderWithProviders(<EditConnectionForm connection={sampleConnection} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show raw config JSON' }));

      fireEvent.change(screen.getByLabelText('Config JSON'), {
        target: { value: '{ not: valid json' },
      });

      expect(screen.getByText('Raw JSON is invalid')).toBeInTheDocument();
      expect(screen.getByLabelText('Shop URL')).toBeDisabled();
      expect(screen.getByLabelText('Shop ID (optional)')).toBeDisabled();
    });
  });
});
