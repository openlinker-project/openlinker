import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../test/test-utils';
import { AdaptersCatalogPage } from './adapters-catalog-page';
import type { AdapterSummary } from '../../features/adapters/api/adapters.types';

const sampleAdapter: AdapterSummary = {
  adapterKey: 'prestashop.webservice.v1',
  platformType: 'prestashop',
  supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
  displayName: 'PrestaShop WebService v1',
  version: '1.0.0',
};

describe('AdaptersCatalogPage', () => {
  afterEach(cleanup);

  it('renders the page heading', () => {
    renderWithProviders(<AdaptersCatalogPage />);
    expect(screen.getByRole('heading', { name: 'Adapter catalog' })).toBeInTheDocument();
  });

  it('displays adapters returned by the API', async () => {
    const apiClient = createMockApiClient({
      adapters: { list: vi.fn().mockResolvedValue([sampleAdapter]) },
    });
    renderWithProviders(<AdaptersCatalogPage />, { apiClient });
    expect(await screen.findByText('PrestaShop WebService v1')).toBeInTheDocument();
    expect(screen.getByText('prestashop')).toBeInTheDocument();
    expect(screen.getByText('ProductMaster')).toBeInTheDocument();
    expect(screen.getByText('InventoryMaster')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
  });

  it('shows loading state while fetching', () => {
    const apiClient = createMockApiClient({
      adapters: { list: vi.fn().mockReturnValue(new Promise(() => {})) },
    });
    renderWithProviders(<AdaptersCatalogPage />, { apiClient });
    expect(screen.getByRole('heading', { name: 'Loading adapters' })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    const apiClient = createMockApiClient({
      adapters: { list: vi.fn().mockRejectedValue(new Error('Network error')) },
    });
    renderWithProviders(<AdaptersCatalogPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'Unable to load adapters' })).toBeInTheDocument();
  });

  it('shows empty state when no adapters exist', async () => {
    const apiClient = createMockApiClient({
      adapters: { list: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<AdaptersCatalogPage />, { apiClient });
    expect(await screen.findByRole('heading', { name: 'No adapters available' })).toBeInTheDocument();
  });

  it('shows adapter key when no display name is provided', async () => {
    const noDisplayName: AdapterSummary = {
      ...sampleAdapter,
      displayName: undefined,
    };
    const apiClient = createMockApiClient({
      adapters: { list: vi.fn().mockResolvedValue([noDisplayName]) },
    });
    renderWithProviders(<AdaptersCatalogPage />, { apiClient });
    // Fallback renders the adapter key in both the strong label and the
    // mono-text subtitle row — assert the strong label specifically.
    const matches = await screen.findAllByText('prestashop.webservice.v1');
    expect(matches.some((el) => el.tagName === 'STRONG')).toBe(true);
  });
});
