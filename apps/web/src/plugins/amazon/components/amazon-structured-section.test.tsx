/**
 * AmazonStructuredSection tests (#4186)
 *
 * @module plugins/amazon/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../../features/connections';
import { createAuthenticatedSessionAdapter, renderWithProviders, sampleConnection } from '../../../test/test-utils';
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

    const germany = await screen.findByRole('checkbox', { name: /Germany/ });
    expect(germany).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Poland/ }));

    expect(sync).toHaveBeenCalledWith('amazonMarketplaceIds', 'A1PA6795UKMFR9,A1C3SOZRARQ6R3');
  });

  it('should keep a stored marketplace this browser does not list', async () => {
    renderWithProviders(<Harness values={{ amazonMarketplaceIds: 'A1PA6795UKMFR9,A9NEWMARKET01' }} />, admin);

    expect(await screen.findByRole('checkbox', { name: /Marketplace A9NEWMARKET01/ })).toBeChecked();
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

    expect(await screen.findByRole('checkbox', { name: /Germany/ })).toBeDisabled();
    expect(screen.getByLabelText('Merchant token')).toBeDisabled();
  });

  it('should change the region and drop the marketplaces of the old one', async () => {
    const sync = vi.fn();
    renderWithProviders(<Harness sync={sync} />, admin);

    fireEvent.change(await screen.findByLabelText('Region'), { target: { value: 'na' } });

    expect(sync).toHaveBeenCalledWith('amazonRegion', 'na');
    expect(sync).toHaveBeenCalledWith('amazonMarketplaceIds', '');
  });

  it('should offer the marketplaces of the chosen region and warn about a region change', async () => {
    renderWithProviders(<Harness values={{ amazonRegion: 'na', amazonMarketplaceIds: 'ATVPDKIKX0DER' }} />, admin);

    expect(await screen.findByRole('checkbox', { name: /United States \(USD\)/ })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Germany/ })).toBeNull();
    expect(screen.getByText(/moves this connection to another Amazon region/)).toBeInTheDocument();
  });

  it('should keep a stored marketplace of another region visible so it can be unticked', async () => {
    renderWithProviders(<Harness values={{ amazonMarketplaceIds: 'A1PA6795UKMFR9,ATVPDKIKX0DER' }} />, admin);

    expect(await screen.findByRole('checkbox', { name: /United States \(USD\) ATVPDKIKX0DER/ })).toBeChecked();
  });
});
