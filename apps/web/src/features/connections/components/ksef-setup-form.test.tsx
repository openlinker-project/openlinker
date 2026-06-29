/**
 * KsefSetupForm Tests
 *
 * Coverage for the single-step KSeF (Polish e-invoicing) setup wizard: that it
 * renders the environment / auth-type / NIP / write-only-secret fields, that
 * validation gates submit, and that a valid submit maps config + write-only
 * credentials to the C2-shaped CreateConnectionInput (env in config; authType +
 * secret in credentials; no secret in config).
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, findToastTitle, renderWithProviders } from '../../../test/test-utils';
import { KsefSetupForm } from './ksef-setup-form';

/**
 * Resolve the `role="alert"` error element bound to a labelled field via its
 * `aria-describedby` wiring (FormField links the input to its FieldError by id).
 * Scoping to the field's own error region keeps the assertion from silently
 * passing on a duplicate render (e.g. the same message echoed in FormErrorSummary).
 */
function fieldError(labelText: string): HTMLElement | null {
  const control = screen.getByLabelText(labelText);
  const describedBy = control.getAttribute('aria-describedby');
  for (const id of describedBy?.split(/\s+/) ?? []) {
    const node = document.getElementById(id);
    if (node?.getAttribute('role') === 'alert') {
      return node;
    }
  }
  return null;
}

describe('KsefSetupForm', () => {
  afterEach(cleanup);

  it('renders the environment, auth-type, NIP and write-only secret fields', () => {
    renderWithProviders(<KsefSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Environment')).toBeInTheDocument();
    expect(screen.getByLabelText('Seller NIP')).toBeInTheDocument();
    expect(screen.getByLabelText('Authentication type')).toBeInTheDocument();
    const secret = screen.getByLabelText('Authentication secret');
    expect(secret).toBeInTheDocument();
    // Write-only: rendered as a password field so the value is never displayed.
    expect(secret).toHaveAttribute('type', 'password');
  });

  it('requires the authentication secret', async () => {
    renderWithProviders(<KsefSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'KSeF main' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect KSeF' }));
    await waitFor(() => {
      const error = fieldError('Authentication secret');
      expect(error).not.toBeNull();
      expect(within(error as HTMLElement).getByText('Authentication secret is required')).toBeInTheDocument();
    });
  });

  it('rejects a malformed seller NIP', async () => {
    renderWithProviders(<KsefSetupForm />);
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'KSeF main' } });
    fireEvent.change(screen.getByLabelText('Seller NIP'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Authentication secret'), {
      target: { value: 'tok_secret_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect KSeF' }));
    await waitFor(() => {
      const error = fieldError('Seller NIP');
      expect(error).not.toBeNull();
      expect(within(error as HTMLElement).getByText('Seller NIP must be 10 digits')).toBeInTheDocument();
    });
  });

  it('maps env to config and the write-only secret to credentials (no secret in config)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-ksef', name: 'KSeF main' });
    const apiClient = createMockApiClient({ connections: { create } });
    renderWithProviders(<KsefSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'KSeF main' } });
    fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'prod' } });
    fireEvent.change(screen.getByLabelText('Seller NIP'), { target: { value: '12-3456789-0' } });
    fireEvent.change(screen.getByLabelText('Authentication type'), {
      target: { value: 'qualified-seal' },
    });
    fireEvent.change(screen.getByLabelText('Authentication secret'), {
      target: { value: 'super-secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect KSeF' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const payload = create.mock.calls[0][0] as {
      platformType: string;
      adapterKey?: string;
      config: Record<string, unknown>;
      credentials?: Record<string, unknown>;
    };
    expect(payload.platformType).toBe('ksef');
    expect(payload.adapterKey).toBe('ksef.publicapi.v2');
    // env (the C2 config-validator-gated field) + normalised NIP (nested under
    // `config.seller`, the shape `resolveSeller` reads) land in config. Country
    // defaults to PL, so the seller carries an address with just the ISO code.
    expect(payload.config.env).toBe('prod');
    expect(payload.config.seller).toEqual({
      nip: '1234567890',
      address: { countryIso2: 'PL' },
    });
    // Write-only: secret travels only in credentials, never in config.
    expect(payload.credentials).toEqual({ authType: 'qualified-seal', secret: 'super-secret-token' });
    expect(JSON.stringify(payload.config)).not.toContain('super-secret-token');

    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('assembles the full nested seller profile (#1223) from name + address fields', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-ksef', name: 'KSeF main' });
    const apiClient = createMockApiClient({ connections: { create } });
    renderWithProviders(<KsefSetupForm />, { apiClient });

    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'KSeF main' } });
    fireEvent.change(screen.getByLabelText('Seller NIP'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByLabelText('Seller legal name'), {
      target: { value: 'ACME Sp. z o.o.' },
    });
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: 'ul. Przykładowa 1' },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Warszawa' } });
    fireEvent.change(screen.getByLabelText('Postal code'), { target: { value: '00-001' } });
    // Country lower-cased on input is normalised to uppercase by the schema.
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'pl' } });
    fireEvent.change(screen.getByLabelText('Authentication secret'), {
      target: { value: 'tok_secret_value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect KSeF' }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const payload = create.mock.calls[0][0] as { config: Record<string, unknown> };
    // The nested shape `resolveSeller` reads; `line2` is omitted when blank.
    expect(payload.config.seller).toEqual({
      nip: '1234567890',
      name: 'ACME Sp. z o.o.',
      address: {
        line1: 'ul. Przykładowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        countryIso2: 'PL',
      },
    });
  });
});
