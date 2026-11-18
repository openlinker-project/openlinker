/**
 * ShopifyStructuredSection tests (#3982)
 *
 * @module plugins/shopify/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  renderWithProviders,
  sampleConnection,
} from '../../../test/test-utils';
import type { Connection } from '../../../features/connections';
import { ShopifyStructuredSection } from './shopify-structured-section';

// The form is now read-only without `connections:write`, so these tests must act as an admin
// (the default noop session holds no permissions) to exercise the editable form.
const renderAsAdmin: typeof renderWithProviders = (ui, options = {}) =>
  renderWithProviders(ui, { sessionAdapter: createAuthenticatedSessionAdapter(), ...options });


const locationsQuery = vi.fn();
vi.mock('../../../features/shopify', () => ({
  useShopifyLocationsQuery: () => locationsQuery(),
}));

const LOCATIONS = [
  { id: '1', name: 'Main', isActive: true, isPrimary: true },
  { id: '2', name: 'Annex', isActive: true, isPrimary: false },
];

function Harness({
  values = {},
  sync = vi.fn(),
  caps = ['OrderSource'],
}: {
  values?: Record<string, string>;
  sync?: (field: string, value: string) => void;
  caps?: string[];
}): ReactElement {
  const form = useForm<any>({
    defaultValues: {
      openlinkerCallbackBaseUrl: '',
      shopifyLocationId: '',
      shopifyUnmanagedStockQuantity: '',
      shopifySalesCountryIso2: '',
      shopifyRefundsThroughShopify: '',
      ...values,
    },
  });
  return (
    <ShopifyStructuredSection
      connection={{ ...sampleConnection, platformType: 'shopify', enabledCapabilities: caps } as Connection}
      form={form}
      configIsParseable
      syncStructuredToJson={sync}
    />
  );
}

afterEach(() => {
  cleanup();
  locationsQuery.mockReset();
});

describe('ShopifyStructuredSection', () => {
  it('should list the store locations, the primary one as the default', async () => {
    locationsQuery.mockReturnValue({ data: LOCATIONS, isSuccess: true, isLoading: false, isError: false });
    const sync = vi.fn();
    renderAsAdmin(<Harness sync={sync} />);

    // The session resolves asynchronously, and the live locations are only read once it grants write access.
    expect(await screen.findByRole('option', { name: 'Primary location (Main)' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Stock location'), { target: { value: '2' } });
    expect(sync).toHaveBeenCalledWith('shopifyLocationId', '2');
  });

  it('should keep a saved location the store no longer has and warn about it', async () => {
    locationsQuery.mockReturnValue({ data: LOCATIONS, isSuccess: true, isLoading: false, isError: false });
    renderAsAdmin(<Harness values={{ shopifyLocationId: '99' }} />);

    expect(await screen.findByRole('option', { name: 'Location 99 (not found in the store)' })).toBeTruthy();
    expect(screen.getByText(/is not an active location of this store/)).toBeTruthy();
  });

  it('should fall back to typing the id when the store cannot be read', () => {
    locationsQuery.mockReturnValue({ data: undefined, isSuccess: false, isLoading: false, isError: true });
    renderAsAdmin(<Harness />);

    expect(screen.getByRole('textbox', { name: 'Stock location' })).toBeTruthy();
    expect(screen.getByText(/locations could not be read/)).toBeTruthy();
  });

  it('should warn that refunds move money once the switch is on', () => {
    locationsQuery.mockReturnValue({ data: LOCATIONS, isSuccess: true, isLoading: false, isError: false });
    renderAsAdmin(<Harness values={{ shopifyRefundsThroughShopify: 'true' }} />);

    expect(screen.getByText(/move real money on Shopify Payments/)).toBeTruthy();
  });

  it('should warn when nothing on the connection uses webhooks', () => {
    locationsQuery.mockReturnValue({ data: LOCATIONS, isSuccess: true, isLoading: false, isError: false });
    renderAsAdmin(<Harness caps={['Invoicing']} />);

    expect(screen.getByText('Webhooks are not available')).toBeTruthy();
  });
});
