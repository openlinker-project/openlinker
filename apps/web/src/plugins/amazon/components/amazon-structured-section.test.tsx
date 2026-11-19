/**
 * AmazonStructuredSection tests (#4186)
 *
 * @module plugins/amazon/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import { AmazonStructuredSection } from './amazon-structured-section';

function Harness({
  values = {},
  sync = vi.fn(),
  caps = ['OrderSource', 'OfferManager'],
  config = { region: 'eu', environment: 'production' },
}: {
  values?: Record<string, string>;
  sync?: (field: string, value: string) => void;
  caps?: string[];
  config?: Record<string, unknown>;
}): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      amazonMarketplaceIds: 'A1PA6795UKMFR9',
      amazonSellerId: 'A2EXAMPLE12345',
      amazonNotificationQueueUrl: '',
      amazonFbaLocationId: '',
      stockLocationOverride: '',
      ...values,
    },
  });
  return (
    <AmazonStructuredSection
      connection={{ ...sampleConnection, platformType: 'amazon', enabledCapabilities: caps, config } as Connection}
      form={form}
      configIsParseable
      syncStructuredToJson={sync}
    />
  );
}

const admin = { sessionAdapter: createAuthenticatedSessionAdapter() };

afterEach(cleanup);

describe('AmazonStructuredSection', () => {
  it('should list the marketplaces of the connection region and sync a change', async () => {
    const sync = vi.fn();
    renderWithProviders(<Harness sync={sync} />, admin);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Marketplaces' }));
    expect(screen.getByRole('option', { name: /Germany/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(16);
    await user.click(screen.getByRole('option', { name: /Poland/ }));

    expect(sync).toHaveBeenCalledWith('amazonMarketplaceIds', 'A1PA6795UKMFR9,A1C3SOZRARQ6R3');
  });

  it('should keep a stored marketplace this browser does not list', async () => {
    renderWithProviders(<Harness values={{ amazonMarketplaceIds: 'A1PA6795UKMFR9,A9NEWMARKET01' }} />, admin);

    expect(await screen.findByText('Marketplace A9NEWMARKET01')).toBeInTheDocument();
  });

  it('should show the merchant token with offers and the queue with orders only', async () => {
    renderWithProviders(<Harness caps={['OrderSource']} />, admin);

    expect(await screen.findByLabelText('SQS queue URL')).toBeInTheDocument();
    expect(screen.queryByLabelText('Merchant token')).toBeNull();

    cleanup();
    renderWithProviders(<Harness caps={['OfferManager']} values={{ amazonSellerId: '' }} />, admin);

    expect(await screen.findByLabelText('Merchant token')).toBeInTheDocument();
    expect(screen.queryByLabelText('SQS queue URL')).toBeNull();
    expect(screen.getByText(/Without the merchant token/)).toBeInTheDocument();
  });

  it('should disable the inputs for a read-only session', async () => {
    const viewer = createAuthenticatedSessionAdapter({
      id: 'u-viewer',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['connections:read'],
    });
    renderWithProviders(<Harness />, { sessionAdapter: viewer });

    expect(await screen.findByRole('combobox', { name: 'Marketplaces' })).toBeDisabled();
    expect(screen.getByLabelText('Merchant token')).toBeDisabled();
  });

  it('should show the region read-only, since another region is another account', async () => {
    renderWithProviders(<Harness />, admin);

    const region = await screen.findByLabelText('Region');
    expect(region).toBeDisabled();
    expect(region).toHaveValue('Europe (EU)');
  });

  it('should offer the marketplaces of the stored region', async () => {
    renderWithProviders(
      <Harness config={{ region: 'na', environment: 'production' }} values={{ amazonMarketplaceIds: 'ATVPDKIKX0DER' }} />,
      admin,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Marketplaces' }));
    expect(screen.getByRole('option', { name: /United States \(USD\)/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: /Germany/ })).toBeNull();
  });

  it('should replace the marketplace instead of adding one in the Far East region', async () => {
    const sync = vi.fn();
    renderWithProviders(
      <Harness
        sync={sync}
        config={{ region: 'fe', environment: 'production' }}
        values={{ amazonMarketplaceIds: 'A1VC38T7YXB528' }}
      />,
      admin,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Marketplaces' }));
    await user.click(screen.getByRole('option', { name: /Australia/ }));

    expect(sync).toHaveBeenCalledWith('amazonMarketplaceIds', 'A39IBJ37TRP1C6');
  });

  it('should keep a stored marketplace of another region visible as a chip so it can be removed', async () => {
    renderWithProviders(<Harness values={{ amazonMarketplaceIds: 'A1PA6795UKMFR9,ATVPDKIKX0DER' }} />, admin);

    expect(await screen.findByText('United States (USD)')).toBeInTheDocument();
  });

  describe('FBA stock location (#4183)', () => {
    const location = (id: string, name: string, status = 'active') => ({
      id,
      code: name.toUpperCase(),
      name,
      kind: 'warehouse',
      status,
      externalRef: null,
      countryIso2: 'PL',
      postcode: null,
      latitude: null,
      longitude: null,
      ownerConnectionId: null,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });
    const withLocations = () =>
      createMockApiClient({
        inventory: {
          listLocations: vi.fn().mockResolvedValue({
            items: [location('ol_location_main', 'Main'), location('ol_location_fba', 'Amazon FBA'), location('ol_location_old', 'Old', 'inactive')],
            total: 3,
            page: 1,
            limit: 100,
          }),
        },
      });

    it('should not show the FBA location unless the connection is the stock master', async () => {
      renderWithProviders(<Harness />, admin);

      await screen.findByRole('combobox', { name: 'Marketplaces' });
      expect(screen.queryByLabelText('FBA stock location')).toBeNull();
    });

    it('should offer the active locations and sync the choice', async () => {
      const sync = vi.fn();
      renderWithProviders(<Harness caps={['InventoryMaster']} sync={sync} />, { ...admin, apiClient: withLocations() });

      const select = await screen.findByLabelText('FBA stock location');
      await within(select).findByRole('option', { name: 'Amazon FBA (AMAZON FBA)' });
      expect(within(select).queryByRole('option', { name: /Old/ })).toBeNull();
      fireEvent.change(select, { target: { value: 'ol_location_fba' } });

      expect(sync).toHaveBeenCalledWith('amazonFbaLocationId', 'ol_location_fba');
    });

    it('should warn when the connection\'s own stock has no separate location', async () => {
      renderWithProviders(
        <Harness caps={['InventoryMaster']} values={{ amazonFbaLocationId: 'ol_location_fba' }} />,
        { ...admin, apiClient: withLocations() },
      );

      expect(await screen.findByText(/Also choose the location of the stock you ship yourself/)).toBeInTheDocument();
      expect(screen.getByText(/FBA stock counts toward what other channels may sell/)).toBeInTheDocument();
    });

    it('should not warn once the own stock has a different location', async () => {
      renderWithProviders(
        <Harness
          caps={['InventoryMaster']}
          values={{ amazonFbaLocationId: 'ol_location_fba', amazonFbmLocationId: 'ol_location_main' }}
        />,
        { ...admin, apiClient: withLocations() },
      );

      await screen.findByLabelText('FBA stock location');
      expect(screen.queryByText(/Also choose the location of the stock you ship yourself/)).toBeNull();
    });

    it('should let the seller place their own stock here while the OMS routing UI is off', async () => {
      const sync = vi.fn();
      renderWithProviders(<Harness caps={['InventoryMaster']} sync={sync} />, { ...admin, apiClient: withLocations() });

      const select = await screen.findByLabelText('Location of the stock you ship (FBM)');
      await screen.findAllByRole('option', { name: 'Main (MAIN)' });
      fireEvent.change(select, { target: { value: 'ol_location_main' } });

      expect(sync).toHaveBeenCalledWith('amazonFbmLocationId', 'ol_location_main');
    });

    it('should leave the own stock location to the host control while the OMS routing UI is on', async () => {
      vi.stubEnv('VITE_OL_OMS_ROUTING_UI_ENABLED', 'true');
      try {
        renderWithProviders(
          <Harness caps={['InventoryMaster']} values={{ amazonFbaLocationId: 'ol_location_fba' }} />,
          { ...admin, apiClient: withLocations() },
        );

        await screen.findByLabelText('FBA stock location');
        expect(screen.queryByLabelText('Location of the stock you ship (FBM)')).toBeNull();
        expect(screen.getByText(/Assign a location to this connection's stock/)).toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
