/**
 * EparagonySetupForm Tests (#1911)
 *
 * Coverage for the guided eparagony.pl setup wizard: required-field
 * validation, the preconditions checklist, the payload shape sent to the
 * generic create-connection mutation, per-field server-error diagnosis, and
 * the copy assertions ADR-042 / spec risk R5 make non-negotiable (no legal-
 * obligation claim, no automatic-registration promise).
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { EparagonySetupForm } from './eparagony-setup-form';

describe('EparagonySetupForm', () => {
  afterEach(cleanup);

  it('renders the required form fields', () => {
    renderWithProviders(<EparagonySetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Client secret')).toBeInTheDocument();
    expect(screen.getByLabelText('POS ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment')).toBeInTheDocument();
    expect(screen.getByLabelText('Integration ID (optional)')).toBeInTheDocument();
  });

  it('defaults the environment select to Sandbox', () => {
    renderWithProviders(<EparagonySetupForm />);
    expect(screen.getByLabelText('Environment')).toHaveValue('sandbox');
  });

  it('requires connection name, client id, client secret and posId', async () => {
    renderWithProviders(<EparagonySetupForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect eparagony.pl' }));

    await waitFor(() => {
      expect(screen.getAllByText('Connection name is required')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Client ID is required')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Client secret is required')[0]).toBeInTheDocument();
      expect(screen.getAllByText('POS ID is required')[0]).toBeInTheDocument();
    });
  });

  it('renders the three named preconditions in a calm, non-alarming tone', () => {
    renderWithProviders(<EparagonySetupForm />);
    expect(screen.getByText(/An online fiscal printer/)).toBeInTheDocument();
    expect(screen.getByText(/printer-control software/)).toBeInTheDocument();
    expect(screen.getByText(/The device set up for e-receipts/)).toBeInTheDocument();
    // No disclaimer-style "cannot verify" language repeated per item.
    expect(screen.queryByText(/OpenLinker cannot check this/)).toBeNull();
    expect(screen.queryByText(/would be misleading/)).toBeNull();
  });

  it('never implies a legal receipt obligation or automatic registration', () => {
    renderWithProviders(<EparagonySetupForm />);
    expect(screen.queryByText(/required to issue/i)).toBeNull();
    expect(screen.queryByText(/you must issue/i)).toBeNull();
    expect(
      screen.getByText(/Connecting does not register anything automatically/),
    ).toBeInTheDocument();
  });

  it('submits the neutral config + credentials shape on save', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My eparagony.pl account' });
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<EparagonySetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My eparagony.pl account' },
    });
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-abc' } });
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret-xyz' } });
    fireEvent.change(screen.getByLabelText('POS ID'), { target: { value: 'openlinker' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect eparagony.pl' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My eparagony.pl account',
          platformType: 'eparagony',
          adapterKey: 'eparagony.documents.v3',
          credentials: { clientId: 'client-abc', clientSecret: 'secret-xyz' },
          config: { environment: 'sandbox', posId: 'openlinker' },
        }),
      );
    });
  });

  it('maps a per-field shape-validation error onto the matching field', async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new ApiError('Invalid connection config', 400, {
          message: 'Invalid connection config',
          errors: [{ path: 'posId', message: 'must be a non-empty string' }],
        }),
      );
    const apiClient = createMockApiClient({ connections: { create } });

    renderWithProviders(<EparagonySetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Acme' } });
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-abc' } });
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret-xyz' } });
    fireEvent.change(screen.getByLabelText('POS ID'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect eparagony.pl' }));

    await waitFor(() => {
      expect(screen.getAllByText('must be a non-empty string')[0]).toBeInTheDocument();
    });
  });
});
