/**
 * SalesDocumentCountryDefaults Tests (#3177)
 *
 * Covers the acceptance criteria: the two-select shape collapsed into ONE
 * control whose options are "Nothing — hold the order" or any single
 * connection carrying a role (`config.salesDocument.documentKind`), and the
 * readback line states the consequence in plain language for both states.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { SalesDocumentCountryDefault } from '../api/sales-document-rules.types';
import { SalesDocumentCountryDefaults } from './sales-document-country-defaults';

const INVOICING_CONNECTION: Connection = {
  ...sampleConnection,
  id: 'conn_invoicing',
  name: 'Ksef Demo',
  platformType: 'ksef',
  status: 'active',
  enabledCapabilities: ['Invoicing'],
  supportedCapabilities: ['Invoicing'],
  config: { salesDocument: { documentKind: 'invoice' } },
};

const FISCALIZATION_CONNECTION: Connection = {
  ...sampleConnection,
  id: 'conn_fiscalization',
  name: 'e-paragony Sandbox',
  platformType: 'eparagony',
  status: 'active',
  enabledCapabilities: ['Fiscalization'],
  supportedCapabilities: ['Fiscalization'],
  config: { salesDocument: { documentKind: 'fiscal-receipt' } },
};

describe('SalesDocumentCountryDefaults', () => {
  it('should render "Nothing — hold the order" and state the held consequence when no default is set', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INVOICING_CONNECTION, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: { listCountryDefaults: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('country-default')).toHaveValue('');
    });
    // "Nothing — hold the order" renders BOTH as the selected option's own
    // label and, verbatim, inside the hint paragraph below the select — so
    // asserting on the select's value (above) is the unambiguous check;
    // `getByText` for that exact phrase would match both.
    expect(screen.getByTestId('country-default-readback')).toHaveTextContent(
      'An order in PL matching none of the rules above has no fallback here and is held.',
    );
  });

  it('should list every connection carrying a role as "{Kind} · {name}"', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INVOICING_CONNECTION, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: { listCountryDefaults: vi.fn().mockResolvedValue([]) },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('Invoice · Ksef Demo')).toBeInTheDocument();
    expect(screen.getByText('Receipt · e-paragony Sandbox')).toBeInTheDocument();
  });

  it('should render the readback naming the current default\'s kind and connection', async () => {
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'PL', documentKind: 'fiscal-receipt', connectionId: 'conn_fiscalization' },
    ];
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INVOICING_CONNECTION, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: { listCountryDefaults: vi.fn().mockResolvedValue(defaults) },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('country-default')).toHaveValue('conn_fiscalization');
    });
    expect(screen.getByTestId('country-default-readback')).toHaveTextContent(
      'An order in PL matching none of the rules above gets a Receipt through e-paragony Sandbox.',
    );
  });

  it('should upsert with the candidate\'s own document kind when a connection is chosen', async () => {
    const upsertCountryDefault = vi.fn().mockResolvedValue({
      id: 'd1',
      country: 'PL',
      documentKind: 'invoice',
      connectionId: 'conn_invoicing',
    });
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INVOICING_CONNECTION, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: {
        listCountryDefaults: vi.fn().mockResolvedValue([]),
        upsertCountryDefault,
      },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('Invoice · Ksef Demo');
    await userEvent.selectOptions(screen.getByTestId('country-default'), 'conn_invoicing');

    await waitFor(() => {
      expect(upsertCountryDefault).toHaveBeenCalledWith({
        country: 'PL',
        documentKind: 'invoice',
        connectionId: 'conn_invoicing',
      });
    });
  });

  it('should delete the existing default when "Nothing — hold the order" is chosen', async () => {
    const deleteCountryDefault = vi.fn().mockResolvedValue(undefined);
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'PL', documentKind: 'invoice', connectionId: 'conn_invoicing' },
    ];
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INVOICING_CONNECTION, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: {
        listCountryDefaults: vi.fn().mockResolvedValue(defaults),
        deleteCountryDefault,
      },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('country-default')).toHaveValue('conn_invoicing');
    });
    await userEvent.selectOptions(screen.getByTestId('country-default'), '');

    await waitFor(() => {
      expect(deleteCountryDefault).toHaveBeenCalledWith('d1');
    });
  });

  it('should still offer the current default\'s own connection even after it loses its role', async () => {
    const staleConnection: Connection = {
      ...INVOICING_CONNECTION,
      config: { salesDocument: {} }, // role withdrawn
    };
    const defaults: SalesDocumentCountryDefault[] = [
      { id: 'd1', country: 'PL', documentKind: 'invoice', connectionId: 'conn_invoicing' },
    ];
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([staleConnection, FISCALIZATION_CONNECTION]) },
      salesDocumentRules: { listCountryDefaults: vi.fn().mockResolvedValue(defaults) },
    });

    renderWithProviders(<SalesDocumentCountryDefaults country="PL" />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await waitFor(() => {
      expect(screen.getByTestId('country-default')).toHaveValue('conn_invoicing');
    });
    expect(screen.getByText(/Ksef Demo \(no longer eligible\)/)).toBeInTheDocument();
    expect(screen.getByTestId('country-default-readback')).toHaveTextContent(
      'An order in PL matching none of the rules above gets a Invoice through Ksef Demo.',
    );
  });
});
