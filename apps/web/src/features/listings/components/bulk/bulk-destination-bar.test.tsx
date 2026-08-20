/**
 * BulkDestinationBar tests (#2227)
 *
 * The bar exists so a screenshot of a wizard step names its destination, so the
 * assertions are about what is legible without interaction: the connection, its
 * environment, its health when it is not active, and one chip for settings moved
 * off the defaults. Also pins the two states the design deliberately renders as
 * "nothing": no environment key (badge omitted rather than guessed) and an
 * all-defaults batch (no chip).
 */
import { fireEvent, screen, cleanup, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkDestinationBar } from './bulk-destination-bar';
import type { Connection } from '../../../connections';
import type { BulkWizardConfig } from './bulk-wizard.types';

function makeConnection(over: Partial<Connection> = {}): Connection {
  return {
    id: 'ol_conn_1234567890',
    name: 'Allegro — Sklep główny',
    platformType: 'allegro',
    status: 'active',
    config: { environment: 'production' },
    credentialsBacked: true,
    enabledCapabilities: ['OfferManager'],
    supportedCapabilities: ['OfferManager', 'OfferCreator'],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as Connection;
}

function makeConfig(over: Partial<BulkWizardConfig> = {}): BulkWizardConfig {
  return {
    connectionId: 'ol_conn_1234567890',
    platformParams: {},
    currency: 'PLN',
    pricingPolicy: { mode: 'use-master' },
    stockPolicy: { mode: 'use-master' },
    publishImmediately: true,
    generateDescription: false,
    ...over,
  };
}

function renderBar(over: {
  connection?: Connection;
  config?: BulkWizardConfig | null;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  onChangeDestination?: () => void;
} = {}) {
  const onToggleSettings = over.onToggleSettings ?? vi.fn();
  const onChangeDestination = over.onChangeDestination ?? vi.fn();
  renderWithProviders(
    <BulkDestinationBar
      connection={over.connection ?? makeConnection()}
      config={over.config === undefined ? makeConfig() : over.config}
      settingsOpen={over.settingsOpen ?? false}
      onToggleSettings={onToggleSettings}
      onChangeDestination={onChangeDestination}
    />,
  );
  return { onToggleSettings, onChangeDestination };
}

afterEach(() => {
  cleanup();
});

/**
 * `ConnectionDot` also renders the name in an `sr-only` span, and the settings
 * panel repeats every value the chip can show - so "visible on the bar" has to
 * be queried inside the bar's own regions, not globally.
 */
function barName(): HTMLElement {
  return screen.getByText('Allegro — Sklep główny', { selector: '.bulk-destbar__name' });
}

function badges(): HTMLElement {
  const region = screen.getByTestId('bulk-destination-bar').querySelector('.bulk-destbar__badges');
  if (region === null) throw new Error('badges region not rendered');
  return region as HTMLElement;
}

describe('BulkDestinationBar', () => {
  it('should name the connection and its environment when the batch targets production', () => {
    renderBar();

    expect(barName()).toBeInTheDocument();
    expect(within(badges()).getByText('Production')).toBeInTheDocument();
    expect(screen.queryByText('Sandbox')).not.toBeInTheDocument();
  });

  it('should flag a sandbox connection on the badge and on the bar itself', () => {
    renderBar({ connection: makeConnection({ config: { environment: 'sandbox' } }) });

    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByTestId('bulk-destination-bar')).toHaveAttribute('data-environment', 'sandbox');
  });

  it('should omit the environment badge when the connection config carries no environment', () => {
    renderBar({ connection: makeConnection({ config: {} }) });

    expect(screen.queryByText('Production')).not.toBeInTheDocument();
    expect(screen.queryByText('Sandbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('bulk-destination-bar')).not.toHaveAttribute('data-environment');
  });

  it('should surface a connection that needs re-auth', () => {
    renderBar({ connection: makeConnection({ status: 'needs_reauth' }) });

    expect(screen.getByText('Needs re-auth')).toBeInTheDocument();
  });

  it('should render no changed-settings chip when the batch runs on defaults', () => {
    renderBar();

    expect(screen.queryByText(/settings changed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Master price \+/)).not.toBeInTheDocument();
  });

  it('should name the single changed setting rather than counting it', () => {
    renderBar({ config: makeConfig({ pricingPolicy: { mode: 'markup', percent: 12 } }) });

    expect(within(badges()).getByText('Master price +12%')).toBeInTheDocument();
    expect(screen.queryByText(/settings changed/)).not.toBeInTheDocument();
  });

  it('should count the changed settings when more than one moved', () => {
    renderBar({
      config: makeConfig({
        pricingPolicy: { mode: 'flat', amount: 39 },
        stockPolicy: { mode: 'cap', value: 20 },
        publishImmediately: false,
      }),
    });

    expect(screen.getByText('3 settings changed')).toBeInTheDocument();
  });

  it('should keep the settings panel hidden until it is opened', () => {
    const { onToggleSettings } = renderBar();

    const toggle = screen.getByRole('button', { name: 'Show settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Listing currency').closest('.bulk-destbar__panel')).toHaveAttribute('hidden');

    fireEvent.click(toggle);
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it('should show the whole step-1 config once open, including platform params', () => {
    renderBar({
      settingsOpen: true,
      config: makeConfig({ platformParams: { deliveryPolicyId: 'Standard 24h' } }),
    });

    expect(screen.getByRole('button', { name: 'Hide settings' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Listing currency').closest('.bulk-destbar__panel')).not.toHaveAttribute('hidden');
    expect(screen.getByText('PLN')).toBeInTheDocument();
    expect(screen.getByText('Master stock')).toBeInTheDocument();
    expect(screen.getByText('Publish immediately')).toBeInTheDocument();
    expect(screen.getByText('Delivery policy id')).toBeInTheDocument();
    expect(screen.getByText('Standard 24h')).toBeInTheDocument();
  });

  it('should ask the wizard to change destination rather than navigating itself', () => {
    const { onChangeDestination } = renderBar({ settingsOpen: true });

    fireEvent.click(screen.getByRole('button', { name: 'Change destination' }));
    expect(onChangeDestination).toHaveBeenCalledTimes(1);
  });

  it('should show identity only, with no settings toggle, before the config is committed', () => {
    renderBar({ config: null });

    expect(barName()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settings/ })).not.toBeInTheDocument();
  });
});
