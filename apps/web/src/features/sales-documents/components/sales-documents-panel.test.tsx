/**
 * SalesDocumentsPanel Tests (#2159)
 *
 * Covers the radio-group behaviour the mockup and the issue AC call out
 * specifically: ONE radio group across ALL rows regardless of capability, and
 * picking a new primary clears the previous one (never leaving two primaries
 * set at once from this UI).
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  sampleConnection,
  renderWithProviders,
} from '../../../test/test-utils';
import type { Connection } from '../../connections';
import { SalesDocumentsPanel } from './sales-documents-panel';

const INFAKT: Connection = {
  ...sampleConnection,
  id: 'conn_infakt',
  name: 'inFakt',
  platformType: 'infakt',
  enabledCapabilities: ['Invoicing'],
  supportedCapabilities: ['Invoicing'],
  config: {
    invoicing: { isPrimary: true, triggerModel: 'auto-on-paid' },
    salesDocument: { documentKind: 'invoice' },
  },
};

const EPARAGONY: Connection = {
  ...sampleConnection,
  id: 'conn_eparagony',
  name: 'eparagony.pl',
  platformType: 'eparagony',
  enabledCapabilities: ['Fiscalization'],
  supportedCapabilities: ['Fiscalization'],
  config: {
    salesDocument: { documentKind: 'fiscal-receipt' },
  },
};

function connectionsById(...connections: Connection[]): Record<string, Connection> {
  return Object.fromEntries(connections.map((c) => [c.id, c]));
}

describe('SalesDocumentsPanel', () => {
  it('should render one row per Invoicing/Fiscalization connection with its capability chip', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, EPARAGONY]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText('inFakt')).toBeInTheDocument();
    expect(screen.getByText('eparagony.pl')).toBeInTheDocument();
    expect(screen.getByText('Invoicing')).toBeInTheDocument();
    expect(screen.getByText('Fiscalization')).toBeInTheDocument();
  });

  it('should render exactly one radio group across all rows regardless of capability', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, EPARAGONY]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('inFakt');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => radio.getAttribute('name') === 'sales-document-primary')).toBe(
      true,
    );
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it('should disable the Trigger select for a non-primary row', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, EPARAGONY]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('inFakt');
    expect(screen.getByRole('combobox', { name: /When inFakt issues/i })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: /When eparagony\.pl issues/i })).toBeDisabled();
  });

  it('should clear the previous primary when a new row is picked as primary', async () => {
    const byId = connectionsById(INFAKT, EPARAGONY);
    const getById = vi.fn(async (connectionId: string) => byId[connectionId]);
    const update = vi.fn().mockResolvedValue(INFAKT);

    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([INFAKT, EPARAGONY]),
        getById,
        update,
      },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('inFakt');
    const eparagonyRadio = screen.getByRole('radio', {
      name: /Mark eparagony\.pl as the primary/i,
    });

    await userEvent.click(eparagonyRadio);

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        'conn_eparagony',
        expect.objectContaining({
          config: expect.objectContaining({
            invoicing: expect.objectContaining({ isPrimary: true }),
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        'conn_infakt',
        expect.objectContaining({
          config: expect.objectContaining({
            invoicing: expect.objectContaining({ isPrimary: false }),
          }),
        }),
      );
    });
  });

  it('should render a conflict alert when more than one row is primary', async () => {
    const conflictingEparagony: Connection = {
      ...EPARAGONY,
      config: { ...EPARAGONY.config, invoicing: { isPrimary: true } },
    };
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, conflictingEparagony]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Two or more connections are set to issue/i,
    );
  });

  it('should render an empty state with no Invoicing/Fiscalization connections', async () => {
    const apiClient = createMockApiClient({
      connections: {
        list: vi.fn().mockResolvedValue([
          { ...sampleConnection, enabledCapabilities: ['ProductMaster'] },
        ]),
      },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByText(/No sales-document connections yet/i)).toBeInTheDocument();
  });

  it('should state that a connection needing re-authentication cannot issue (#2550)', async () => {
    const needsReauth: Connection = {
      ...EPARAGONY,
      status: 'needs_reauth',
    };
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, needsReauth]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('eparagony.pl');
    expect(screen.getByText('Cannot issue until reconnected')).toBeInTheDocument();
    // The healthy row does not carry the same note.
    const infaktRow = screen.getByText('inFakt').closest('tr');
    expect(infaktRow ? within(infaktRow).queryByText(/Cannot issue/i) : null).toBeNull();
  });

  it('should mark a connection with nothing set as not a routing candidate (#2550)', async () => {
    const unconfigured: Connection = {
      ...EPARAGONY,
      config: {},
    };
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, unconfigured]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await screen.findByText('eparagony.pl');
    expect(screen.getByText('Not a routing candidate')).toBeInTheDocument();
  });

  it('should state where the primary rule applies, above the table', async () => {
    const apiClient = createMockApiClient({
      connections: { list: vi.fn().mockResolvedValue([INFAKT, EPARAGONY]) },
    });

    renderWithProviders(<SalesDocumentsPanel />, {
      apiClient,
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(
      await screen.findByText(/Only one connection may go first across ALL of them/i),
    ).toBeInTheDocument();
  });
});
