/**
 * ConnectionMappingsPage tests
 *
 * @module apps/web/src/pages/connections
 */

import { cleanup, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { ConnectionMappingsPage } from './connection-mappings-page';
import type { StatusMapping, MappingOption } from '../../features/mappings/api/mappings.types';

const STATUS_OPTIONS: MappingOption[] = [
  { value: 'READY_FOR_PROCESSING', label: 'Ready for processing' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const PS_STATUS_OPTIONS: MappingOption[] = [
  { value: '2', label: 'Payment accepted' },
  { value: '6', label: 'Cancelled' },
];

const SAVED_STATUS_MAPPINGS: StatusMapping[] = [
  {
    id: 'mapping-1',
    connectionId: 'conn-1',
    allegroStatus: 'READY_FOR_PROCESSING',
    prestashopStatusId: '2',
  },
];

const BASE_MAPPINGS_MOCKS = {
  getStatusMappings: vi.fn().mockResolvedValue([]),
  upsertStatusMappings: vi.fn().mockResolvedValue([]),
  getCarrierMappings: vi.fn().mockResolvedValue([]),
  upsertCarrierMappings: vi.fn().mockResolvedValue([]),
  getPaymentMappings: vi.fn().mockResolvedValue([]),
  upsertPaymentMappings: vi.fn().mockResolvedValue([]),
  getAllegroOrderStatuses: vi.fn().mockResolvedValue(STATUS_OPTIONS),
  getAllegroDeliveryMethods: vi.fn().mockResolvedValue([]),
  getAllegroPaymentProviders: vi.fn().mockResolvedValue([]),
  getPrestashopOrderStatuses: vi.fn().mockResolvedValue(PS_STATUS_OPTIONS),
  getPrestashopCarriers: vi.fn().mockResolvedValue([]),
  getPrestashopPaymentModules: vi.fn().mockResolvedValue([]),
};

function buildApiClient(mappingsOverrides: Partial<typeof BASE_MAPPINGS_MOCKS> = {}): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    mappings: { ...BASE_MAPPINGS_MOCKS, ...mappingsOverrides },
  });
}

describe('ConnectionMappingsPage', () => {
  afterEach(cleanup);

  it('renders the page layout with tab navigation', async () => {
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Order Statuses' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Carriers' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payments' })).toBeInTheDocument();
  });

  it('renders empty state when no status mappings exist', async () => {
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByText('No mappings configured')).toBeInTheDocument();
    });
  });

  it('renders table rows when status mappings exist', async () => {
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      // Labels appear in both the table cell and the dropdown options — verify the table cell
      const cells = screen.getAllByText('Ready for processing');
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.some((el) => el.tagName === 'TD')).toBe(true);
    });
  });

  it('shows unsaved changes indicator after adding a row', async () => {
    const apiClient = buildApiClient();
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    // Wait for page to finish loading
    await waitFor(() => {
      expect(screen.getByText('Mapping Configuration')).toBeInTheDocument();
    });

    // Select source option
    const sourceSelect = screen.getByRole('combobox', { name: /Select Allegro status/i });
    fireEvent.change(sourceSelect, { target: { value: 'READY_FOR_PROCESSING' } });

    // Select target option
    const targetSelect = screen.getByRole('combobox', { name: /Select PrestaShop status/i });
    fireEvent.change(targetSelect, { target: { value: '2' } });

    // Add the row
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  it('calls upsertStatusMappings on save', async () => {
    const upsertFn = vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS);
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
      upsertStatusMappings: upsertFn,
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      expect(screen.getByText('Ready for processing')).toBeInTheDocument();
    });

    // Delete the existing row to make the state dirty
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));

    await waitFor(() => {
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(upsertFn).toHaveBeenCalledWith('', { items: [] });
    });
  });

  it('displays error message on save failure', async () => {
    const apiClient = buildApiClient({
      getStatusMappings: vi.fn().mockResolvedValue(SAVED_STATUS_MAPPINGS),
      upsertStatusMappings: vi.fn().mockRejectedValue(new Error('Server error')),
    });
    renderWithProviders(<ConnectionMappingsPage />, { apiClient });

    await waitFor(() => {
      expect(screen.getByText('Ready for processing')).toBeInTheDocument();
    });

    // Make dirty by deleting a row
    fireEvent.click(screen.getByRole('button', { name: /Remove mapping for Ready for processing/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Save mappings' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });
  });

  it('switches between tabs', async () => {
    renderWithProviders(<ConnectionMappingsPage />, { apiClient: buildApiClient() });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Carriers' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Carriers' }));

    expect(screen.getByRole('tab', { name: 'Carriers' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Carrier Mappings')).toBeInTheDocument();
  });
});
