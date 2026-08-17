/**
 * OrderReceiptPanel — component tests (#1909)
 *
 * Drives the panel through a mocked API client. Asserts the capability gate,
 * per-status rendering, the manual register action, and the fiscal-safety
 * rules ADR-042 makes non-negotiable: `in-doubt` NEVER offers a retry, an
 * empty artefact list on a `registered` record renders as success, and both
 * legally required identifiers render independently.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders, createMockApiClient, sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';
import { OrderReceiptPanel } from './order-receipt-panel';

afterEach(cleanup);

const ORDER_ID = 'ord_1';
const CONN_ID = 'conn_fiscal';

const fiscalConnection: Connection = {
  ...sampleConnection,
  id: CONN_ID,
  name: 'eparagony.pl',
  status: 'active',
  enabledCapabilities: ['Fiscalization'],
  supportedCapabilities: ['Fiscalization'],
};

function makeRecord(over: Partial<FiscalRegistrationRecord> = {}): FiscalRegistrationRecord {
  return {
    id: 'fr_1',
    connectionId: CONN_ID,
    orderId: ORDER_ID,
    providerType: 'eparagony',
    idempotencyKey: `fiscal:${CONN_ID}:${ORDER_ID}`,
    status: 'registered',
    providerReference: 'ep_1',
    documentReference: '1/2026/08/14',
    signingIdentity: 'ABC 1234567890',
    registeredAt: '2026-08-14T09:44:00.000Z',
    regimeExtras: null,
    artefacts: [],
    failureMode: null,
    failureReason: null,
    createdAt: '2026-08-14T09:43:00.000Z',
    updatedAt: '2026-08-14T09:44:00.000Z',
    ...over,
  };
}

describe('OrderReceiptPanel — capability gate', () => {
  it('renders nothing when no connection declares Fiscalization', async () => {
    const { container } = renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([sampleConnection]) } }),
    });
    await waitFor(() => expect(container.querySelector('.order-receipt-panel')).toBeNull());
  });
});

describe('OrderReceiptPanel — not-registered', () => {
  it('shows the register action and never asserts the order requires a receipt', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]) },
      }),
    });
    // Wait on the settled body copy, not the badge — the badge already reads
    // "Not registered" on the very first render (derived from a null record),
    // before the `listForOrder` query resolves, so asserting on it first would
    // race the loading skeleton instead of the actual not-registered content.
    expect(
      await screen.findByText(/Whether this sale needs one is your call, not OpenLinker's/),
    ).toBeInTheDocument();
    expect(screen.getByText('Not registered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register receipt' })).toBeInTheDocument();
  });

  it('calls register with the order and connection on click', async () => {
    const register = vi.fn().mockResolvedValue(makeRecord({ status: 'pending' }));
    const user = userEvent.setup();
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([]), register },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Register receipt' }));
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({ connectionId: CONN_ID, orderId: ORDER_ID }),
    );
  });
});

describe('OrderReceiptPanel — registered', () => {
  it('renders both documentReference and signingIdentity independently', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([makeRecord()]) },
      }),
    });
    expect(await screen.findByText('1/2026/08/14')).toBeInTheDocument();
    expect(screen.getByText('ABC 1234567890')).toBeInTheDocument();
  });

  it('shows a missing identifier as "Not reported", not blank', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: {
          listForOrder: vi.fn().mockResolvedValue([makeRecord({ signingIdentity: null })]),
        },
      }),
    });
    await screen.findByText('1/2026/08/14');
    expect(screen.getByText('Not reported')).toBeInTheDocument();
  });

  it('renders an empty artefact list as a SUCCESS state, never as incomplete', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: { listForOrder: vi.fn().mockResolvedValue([makeRecord({ artefacts: [] })]) },
      }),
    });
    expect(await screen.findByText(/Registered, with nothing to hand over/)).toBeInTheDocument();
  });

  it('renders a link artefact as an openable action', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: {
          listForOrder: vi.fn().mockResolvedValue([
            makeRecord({
              artefacts: [
                { medium: 'link', disposition: 'display', content: 'https://ep.example/r/1', contentType: null, label: null },
              ],
            }),
          ]),
        },
      }),
    });
    const openLink = await screen.findByRole('link', { name: 'Open' });
    expect(openLink).toHaveAttribute('href', 'https://ep.example/r/1');
  });
});

describe('OrderReceiptPanel — rejected (retryable)', () => {
  it('offers Register receipt again when failureMode is rejected', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: {
          listForOrder: vi
            .fn()
            .mockResolvedValue([makeRecord({ status: 'failed', failureMode: 'rejected', failureReason: 'Invalid tax rate' })]),
        },
      }),
    });
    expect(await screen.findByText('Invalid tax rate')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Register receipt' });
    expect(retry).toBeEnabled();
  });
});

describe('OrderReceiptPanel — in-doubt (fiscal-safety)', () => {
  it('NEVER offers a retry control, only Look it up', async () => {
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: {
          listForOrder: vi
            .fn()
            .mockResolvedValue([makeRecord({ status: 'failed', failureMode: 'in-doubt', failureReason: 'Timed out' })]),
        },
      }),
    });
    expect(await screen.findByText(/This sale may already be registered/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register receipt' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Look it up' })).toBeInTheDocument();
  });

  it('calls reconcile, never register, from Look it up', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      outcome: 'not-found',
      record: makeRecord({ status: 'failed', failureMode: 'in-doubt' }),
    });
    const register = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<OrderReceiptPanel orderId={ORDER_ID} />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([fiscalConnection]) },
        fiscalization: {
          listForOrder: vi
            .fn()
            .mockResolvedValue([makeRecord({ status: 'failed', failureMode: 'in-doubt' })]),
          reconcile,
          register,
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Look it up' }));
    await waitFor(() => expect(reconcile).toHaveBeenCalledWith('fr_1'));
    expect(register).not.toHaveBeenCalled();
  });
});
