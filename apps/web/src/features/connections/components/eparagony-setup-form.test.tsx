/**
 * EparagonySetupForm Tests (#1911, document choice #3769)
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
import {
  EPARAGONY_SETUP_DEFAULT_VALUES,
  toCreateConnectionInput,
  type EparagonySetupFormSubmission,
} from './eparagony-setup.schema';

const BASE_SUBMISSION: EparagonySetupFormSubmission = {
  ...(EPARAGONY_SETUP_DEFAULT_VALUES as EparagonySetupFormSubmission),
  name: 'Acme',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  posId: 'openlinker',
};

function fillAccount(): void {
  fireEvent.change(screen.getByLabelText('Connection name'), {
    target: { value: 'My eparagony.pl account' },
  });
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-abc' } });
  fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret-xyz' } });
  fireEvent.change(screen.getByLabelText('POS ID'), { target: { value: 'openlinker' } });
}

function toggle(label: 'Fiscal e-receipts' | 'Invoices'): void {
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(`^${label}`) }));
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Connect eparagony.pl' }));
}

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

  it('never implies a legal receipt obligation', () => {
    // "Connecting does not issue anything by itself" moved to the page
    // description (#3769), where it covers both document kinds; see
    // pages/connections/eparagony-setup-page.test.tsx.
    renderWithProviders(<EparagonySetupForm />);
    expect(screen.queryByText(/required to issue/i)).toBeNull();
    expect(screen.queryByText(/you must issue/i)).toBeNull();
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

  it('rejects an integration ID with no colon separator', async () => {
    renderWithProviders(<EparagonySetupForm />);

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'My eparagony.pl account' },
    });
    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-abc' } });
    fireEvent.change(screen.getByLabelText('Client secret'), { target: { value: 'secret-xyz' } });
    fireEvent.change(screen.getByLabelText('POS ID'), { target: { value: 'openlinker' } });
    fireEvent.change(screen.getByLabelText('Integration ID (optional)'), {
      target: { value: 'no-colon-here' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect eparagony.pl' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('Must be of the form integration:secret, e.g. openlinker:abc123')[0],
      ).toBeInTheDocument();
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

  it('creates a receipts-only connection by default, never one that claims it can invoice', () => {
    // Invoicing is an explicit choice that brings its own seller fields (#3769).
    // Omitting `enabledCapabilities` would let the server default to the
    // adapter manifest's supported set - which lists `'Invoicing'` - and mint a
    // connection with no seller tax number.
    const payload = toCreateConnectionInput(BASE_SUBMISSION);

    expect(payload.enabledCapabilities).toEqual(['Fiscalization']);
  });

  it('sends only core capability names, which is what the create DTO accepts', () => {
    // `CreateConnectionDto.enabledCapabilities` is validated with
    // `@IsIn(CoreCapabilityValues, { each: true })`, and neither
    // `'FiscalRegistrationLocator'` nor `'RegulatoryStatusReader'` is a core
    // capability - sending the manifest's full four here would 400 on every
    // create. They are narrowed from the dispatched adapter with their `is*`
    // guard and read off `enabledCapabilities` by nothing.
    const payload = toCreateConnectionInput({
      ...BASE_SUBMISSION,
      enabledCapabilities: ['Fiscalization', 'Invoicing'],
      merchantTIN: '5252556107',
    });

    expect(payload.enabledCapabilities).not.toContain('FiscalRegistrationLocator');
    expect(payload.enabledCapabilities).not.toContain('RegulatoryStatusReader');
  });

  describe('document choice (#3769)', () => {
    it('offers e-receipts and invoices, with e-receipts ticked by default', () => {
      renderWithProviders(<EparagonySetupForm />);
      expect(screen.getByRole('group', { name: 'What should this connection issue?' })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /^Fiscal e-receipts/ })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /^Invoices/ })).not.toBeChecked();
    });

    it('refuses to submit with no document chosen, and creates nothing', async () => {
      const create = vi.fn();
      renderWithProviders(<EparagonySetupForm />, {
        apiClient: createMockApiClient({ connections: { create } }),
      });
      fillAccount();
      toggle('Fiscal e-receipts');
      submit();
      await waitFor(() =>
        expect(
          screen.getAllByText('Pick at least one: e-receipts, invoices, or both.')[0],
        ).toBeInTheDocument(),
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('shows the printer checklist for e-receipts only', () => {
      renderWithProviders(<EparagonySetupForm />);
      expect(screen.getByText('Before you connect your printer')).toBeInTheDocument();
      toggle('Fiscal e-receipts');
      toggle('Invoices');
      expect(screen.queryByText('Before you connect your printer')).toBeNull();
    });

    it('shows the seller fields only once invoices are chosen', () => {
      renderWithProviders(<EparagonySetupForm />);
      expect(screen.queryByLabelText('Tax number (NIP)')).toBeNull();
      toggle('Invoices');
      expect(screen.getByLabelText('Tax number (NIP)')).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Seller address (optional)' })).toBeInTheDocument();
      expect(screen.getByLabelText('Send invoices on to KSeF')).not.toBeChecked();
    });

    it('requires the seller tax number when invoices are chosen', async () => {
      const create = vi.fn();
      renderWithProviders(<EparagonySetupForm />, {
        apiClient: createMockApiClient({ connections: { create } }),
      });
      fillAccount();
      toggle('Invoices');
      submit();
      await waitFor(() =>
        expect(
          screen.getAllByText('Tax number (NIP) is required to issue invoices')[0],
        ).toBeInTheDocument(),
      );
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a half-filled address with one summary line and a mark on each missing part', async () => {
      renderWithProviders(<EparagonySetupForm />);
      fillAccount();
      toggle('Invoices');
      fireEvent.change(screen.getByLabelText('Tax number (NIP)'), {
        target: { value: '5252556107' },
      });
      fireEvent.change(screen.getByLabelText('Street'), { target: { value: 'Prosta' } });
      submit();
      await waitFor(() =>
        expect(
          screen.getByText('Complete the seller address, or leave it empty.'),
        ).toBeInTheDocument(),
      );
      // Building, postal code and city. Country is prefilled and the apartment is optional.
      expect(screen.getAllByText('Required.')).toHaveLength(3);
    });

    it('explains that an order gets one document when both are chosen', () => {
      renderWithProviders(<EparagonySetupForm />);
      expect(screen.queryByText(/An order gets one document, never both/)).toBeNull();
      toggle('Invoices');
      expect(screen.getByText(/An order gets one document, never both/)).toBeInTheDocument();
    });

    it('sends the chosen capabilities and the seller config for an invoicing connection', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My eparagony.pl account' });
      renderWithProviders(<EparagonySetupForm />, {
        apiClient: createMockApiClient({ connections: { create } }),
      });
      fillAccount();
      toggle('Invoices');
      fireEvent.change(screen.getByLabelText('Tax number (NIP)'), {
        target: { value: '5252556107' },
      });
      fireEvent.change(screen.getByLabelText('Seller name (optional)'), {
        target: { value: 'OpenLinker Test Sp. z o.o.' },
      });
      submit();
      await waitFor(() =>
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            enabledCapabilities: ['Fiscalization', 'Invoicing'],
            config: {
              environment: 'sandbox',
              posId: 'openlinker',
              merchantTIN: '5252556107',
              merchantName: 'OpenLinker Test Sp. z o.o.',
              eInvoicingHubEnabled: false,
            },
          }),
        ),
      );
    });

    it('names the numbering series and the sales-document rule after creating a dual-role connection', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My eparagony.pl account' });
      renderWithProviders(<EparagonySetupForm />, {
        apiClient: createMockApiClient({ connections: { create } }),
      });
      fillAccount();
      toggle('Invoices');
      fireEvent.change(screen.getByLabelText('Tax number (NIP)'), {
        target: { value: '5252556107' },
      });
      submit();
      await waitFor(() => expect(screen.getByText('Before the first invoice')).toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Set up numbering' })).toHaveAttribute(
        'href',
        '/connections/conn-1/numbering',
      );
      expect(screen.getByRole('link', { name: 'Open sales documents' })).toHaveAttribute(
        'href',
        '/settings/sales-documents',
      );
    });

    it('names no invoice next steps after creating a receipts-only connection', async () => {
      const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My eparagony.pl account' });
      renderWithProviders(<EparagonySetupForm />, {
        apiClient: createMockApiClient({ connections: { create } }),
      });
      fillAccount();
      submit();
      await waitFor(() => expect(screen.getByText('Connection created')).toBeInTheDocument());
      expect(screen.queryByText('Before the first invoice')).toBeNull();
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
    });
  });

  describe('toCreateConnectionInput (#3769)', () => {
    it('writes no seller keys for a receipts-only connection, even when seller fields hold values', () => {
      const payload = toCreateConnectionInput({ ...BASE_SUBMISSION, merchantTIN: '5252556107' });
      expect(payload.config).toEqual({ environment: 'sandbox', posId: 'openlinker' });
    });

    it('writes a complete address with an upper-cased country and no empty apartment', () => {
      const payload = toCreateConnectionInput({
        ...BASE_SUBMISSION,
        enabledCapabilities: ['Invoicing'],
        merchantTIN: '5252556107',
        merchantStreet: 'Prosta',
        merchantNumber: '51',
        merchantPostalCode: '00-838',
        merchantCity: 'Warszawa',
        merchantCountry: 'pl',
        eInvoicingHubEnabled: true,
      });
      expect(payload.enabledCapabilities).toEqual(['Invoicing']);
      expect(payload.config).toEqual({
        environment: 'sandbox',
        posId: 'openlinker',
        merchantTIN: '5252556107',
        merchantAddress: {
          street: 'Prosta',
          number: '51',
          postalCode: '00-838',
          city: 'Warszawa',
          country: 'PL',
        },
        eInvoicingHubEnabled: true,
      });
    });

    it('sends capabilities in product order whatever order they were ticked in', () => {
      const payload = toCreateConnectionInput({
        ...BASE_SUBMISSION,
        enabledCapabilities: ['Invoicing', 'Fiscalization'],
        merchantTIN: '5252556107',
      });
      expect(payload.enabledCapabilities).toEqual(['Fiscalization', 'Invoicing']);
    });
  });
});
