/**
 * AmazonStructuredSection tests (#4186)
 *
 * @module plugins/amazon/components
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness wraps RHF with a flexible form type */
import type { ReactElement } from 'react';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
});
