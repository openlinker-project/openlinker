/**
 * ConnectionDetailPage - shipping cards and the OMS setup return link (#3958)
 *
 * A carrier's page lists the delivery methods routed to it per order source,
 * an order source's page summarises how many of its delivery methods get an
 * OpenLinker label, and a page reached from the OMS setup offers the way back.
 */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../features/connections/api/connections.types';
import type { RoutingRule } from '../../features/mappings';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import { ConnectionDetailPage } from './connection-detail-page';
import { NewConnectionPage } from './new-connection-page';

afterEach(cleanup);

const adminSession = createAuthenticatedSessionAdapter();

const INPOST_ID = '44444444-4444-4444-8444-444444444444';
const ALLEGRO_ID = '55555555-5555-4555-8555-555555555555';
const ERLI_ID = '66666666-6666-4666-8666-666666666666';

const inpost: Connection = {
  ...sampleConnection,
  id: INPOST_ID,
  name: 'InPost main',
  platformType: 'inpost',
  adapterKey: 'inpost.shipx.v1',
  config: {},
  enabledCapabilities: ['ShippingProviderManager'],
  supportedCapabilities: ['ShippingProviderManager'],
};

const allegro: Connection = {
  ...sampleConnection,
  id: ALLEGRO_ID,
  name: 'Allegro shop',
  platformType: 'allegro',
  adapterKey: 'allegro.publicapi.v1',
  config: {},
  enabledCapabilities: ['OrderSource'],
  supportedCapabilities: ['OrderSource'],
};

const erli: Connection = {
  ...allegro,
  id: ERLI_ID,
  name: 'Erli shop',
  platformType: 'erli',
  adapterKey: 'erli.shopapi.v1',
};

const METHODS = [
  { value: 'm-locker', label: 'InPost Paczkomat' },
  { value: 'm-courier', label: 'Courier' },
  { value: 'm-pickup', label: 'Personal pickup' },
];

function rule(
  sourceConnectionId: string,
  methodId: string,
  overrides: Partial<RoutingRule> = {}
): RoutingRule {
  return {
    id: `rule-${sourceConnectionId}-${methodId}`,
    sourceConnectionId,
    sourceDeliveryMethodId: methodId,
    processorKind: 'ol_managed_carrier',
    processorConnectionId: INPOST_ID,
    ...overrides,
  };
}

interface ApiSetup {
  readonly connection: Connection;
  readonly rulesBySource?: Record<string, RoutingRule[]>;
  readonly deliveryMethodsFail?: boolean;
}

function apiFor({
  connection,
  rulesBySource = {},
  deliveryMethodsFail = false,
}: ApiSetup): ReturnType<typeof createMockApiClient> {
  return createMockApiClient({
    connections: {
      getById: vi.fn().mockResolvedValue(connection),
      list: vi.fn().mockResolvedValue([inpost, allegro, erli]),
    },
    mappings: {
      getRoutingRules: vi.fn((id: string) => Promise.resolve(rulesBySource[id] ?? [])),
      getMappingOptions: vi.fn((_id: string, side: string, kind: string) => {
        if (side === 'source' && kind === 'delivery-methods') {
          return deliveryMethodsFail
            ? Promise.reject(new Error('This source cannot list delivery methods'))
            : Promise.resolve(METHODS);
        }
        return Promise.resolve([]);
      }),
    },
  });
}

async function renderDetail(
  connection: Connection,
  apiClient: ReturnType<typeof createMockApiClient>,
  search = ''
): Promise<void> {
  renderWithProviders(
    <Routes>
      <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
    </Routes>,
    { apiClient, route: `/connections/${connection.id}${search}`, sessionAdapter: adminSession }
  );
  await screen.findByRole('heading', { name: 'Overview' });
}

describe('ConnectionDetailPage - carrier "Ships for" card', () => {
  it('lists, per order source, the delivery methods routed to this carrier', async () => {
    const apiClient = apiFor({
      connection: inpost,
      rulesBySource: {
        [ALLEGRO_ID]: [
          rule(ALLEGRO_ID, 'm-locker'),
          // Routed to a different carrier: not listed on InPost's page.
          rule(ALLEGRO_ID, 'm-courier', { processorConnectionId: 'other-carrier' }),
        ],
      },
    });
    await renderDetail(inpost, apiClient);

    expect(await screen.findByRole('heading', { name: 'Ships for' })).toBeInTheDocument();

    const allegroRow = await screen.findByTestId(`ships-for-row-${ALLEGRO_ID}`);
    expect(await within(allegroRow).findByText('InPost Paczkomat')).toBeInTheDocument();
    expect(within(allegroRow).queryByText(/Courier/)).toBeNull();
    expect(within(allegroRow).getByRole('button', { name: 'Change' })).toBeInTheDocument();

    const erliRow = screen.getByTestId(`ships-for-row-${ERLI_ID}`);
    expect(
      await within(erliRow).findByText('No delivery method goes to InPost main yet.')
    ).toBeInTheDocument();
    expect(within(erliRow).getByRole('button', { name: 'Choose' })).toBeInTheDocument();
  });

  it('opens the routing editor for the source whose row was clicked', async () => {
    const user = userEvent.setup();
    await renderDetail(inpost, apiFor({ connection: inpost }));

    const erliRow = await screen.findByTestId(`ships-for-row-${ERLI_ID}`);
    await user.click(await within(erliRow).findByRole('button', { name: 'Choose' }));

    expect(
      await screen.findByRole('dialog', { name: 'Who ships Erli shop orders' })
    ).toBeInTheDocument();
  });

  it('does not render the card on a connection that is not a carrier', async () => {
    await renderDetail(allegro, apiFor({ connection: allegro }));
    expect(screen.queryByRole('heading', { name: 'Ships for' })).toBeNull();
  });

  it('after the carrier wizard, says what to do next and opens the first source with no route to it', async () => {
    const user = userEvent.setup();
    const apiClient = apiFor({
      connection: inpost,
      rulesBySource: { [ALLEGRO_ID]: [rule(ALLEGRO_ID, 'm-locker')] },
    });
    await renderDetail(inpost, apiClient, '?created=1');

    expect(await screen.findByText('InPost main is connected.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Next, choose which delivery methods InPost main ships. Until then no order goes to it.'
      )
    ).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Choose delivery methods' }));
    // Allegro already routes a method here, so the next decision is Erli's.
    expect(
      await screen.findByRole('dialog', { name: 'Who ships Erli shop orders' })
    ).toBeInTheDocument();
  });

  it('shows no success notice on an ordinary visit', async () => {
    await renderDetail(inpost, apiFor({ connection: inpost }));
    await screen.findByRole('heading', { name: 'Ships for' });
    expect(screen.queryByText('InPost main is connected.')).toBeNull();
  });
});

describe('ConnectionDetailPage - order source "Shipping" card', () => {
  it('counts the delivery methods that get an OpenLinker label and opens the routing editor', async () => {
    const user = userEvent.setup();
    const apiClient = apiFor({
      connection: allegro,
      rulesBySource: {
        [ALLEGRO_ID]: [
          rule(ALLEGRO_ID, 'm-locker'),
          rule(ALLEGRO_ID, 'm-courier', {
            processorKind: 'source_brokered',
            processorConnectionId: ALLEGRO_ID,
          }),
          // A rule for a method the source no longer lists routes no order.
          rule(ALLEGRO_ID, 'm-gone'),
        ],
      },
    });
    await renderDetail(allegro, apiClient);

    expect(await screen.findByRole('heading', { name: 'Shipping' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        (_content, el) =>
          el?.classList.contains('source-shipping__coverage') === true &&
          el.textContent === '2 of 3 delivery methods get an OpenLinker label',
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 delivery method is shipped by your shop, the way it was before OpenLinker.'
      )
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change who ships what' }));
    expect(
      await screen.findByRole('dialog', { name: 'Who ships Allegro shop orders' })
    ).toBeInTheDocument();
  });

  it('shows one muted line instead of the card when the source cannot list delivery methods', async () => {
    await renderDetail(allegro, apiFor({ connection: allegro, deliveryMethodsFail: true }));

    expect(
      await screen.findByText(
        'This sales channel cannot list its delivery methods, so there is nothing to route here.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Shipping' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change who ships what' })).toBeNull();
  });
});

describe('OMS setup return link', () => {
  it('offers "Back to OMS setup" on the detail page when reached from the OMS setup', async () => {
    await renderDetail(inpost, apiFor({ connection: inpost }), '?created=1&from=oms-setup');

    const back = screen.getByRole('link', { name: /Back to OMS setup/ });
    expect(back).toHaveAttribute('href', '/settings/packing?step=shipping');
    expect(screen.queryByRole('link', { name: /^← ?Connections$/ })).toBeNull();
  });

  it('ignores any other from value and links back to Connections', async () => {
    await renderDetail(inpost, apiFor({ connection: inpost }), '?from=https://evil.example');

    expect(screen.queryByRole('link', { name: /Back to OMS setup/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Connections/ })).toHaveAttribute(
      'href',
      '/connections'
    );
  });

  it('offers the way back on the new-connection picker and keeps the marker on every platform card', async () => {
    renderWithProviders(<NewConnectionPage />, {
      apiClient: createMockApiClient(),
      route: '/connections/new?from=oms-setup',
      sessionAdapter: adminSession,
    });

    expect(screen.getByRole('link', { name: /Back to OMS setup/ })).toHaveAttribute(
      'href',
      '/settings/packing?step=shipping'
    );
    expect(screen.getByRole('link', { name: /^InPost\b/ })).toHaveAttribute(
      'href',
      '/connections/new/inpost?from=oms-setup'
    );
  });

  it('keeps the plain back link on the new-connection picker otherwise', () => {
    renderWithProviders(<NewConnectionPage />, { route: '/connections/new' });

    expect(screen.queryByRole('link', { name: /Back to OMS setup/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^InPost\b/ })).toHaveAttribute(
      'href',
      '/connections/new/inpost'
    );
  });
});
