/**
 * Buyer emails settings + template editor (#3555, mockup M21)
 *
 * Pins: off by default with the "channel already notifies" note; a marketplace
 * connection is not offered "Order confirmed" and says why; the master switch
 * writes `config.buyerEmails` without touching other keys; the editor saves
 * the per-connection switch and sender, then the shared wording on the seeded
 * rule (activating it); a test send reaches `editor-sent`.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuyerEmailsPage } from './buyer-emails-page';
import { BuyerEmailEditorPage } from './buyer-email-editor-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
  sampleConnection,
} from '../../test/test-utils';
import type { SessionUser } from '../../shared/auth/session.types';
import type { Connection } from '../../features/connections';
import type { AutomationRule } from '../../features/automation';

const ADMIN: SessionUser = {
  id: 'user_1',
  username: 'admin',
  email: 'admin@example.com',
  role: 'admin',
  permissions: ['orders:read', 'orders:write', 'connections:write'],
  analyticsConsent: true,
};

const SHOP: Connection = { ...sampleConnection, id: 'conn-shop', name: 'Shop', config: { baseUrl: 'x' } };
const MARKETPLACE: Connection = {
  ...sampleConnection,
  id: 'conn-allegro',
  name: 'Allegro',
  platformType: 'allegro',
  config: {},
  enabledCapabilities: ['OfferManager', 'OrderSource'],
};

const SHIPPED_RULE: AutomationRule = {
  id: 'rule-shipped',
  name: 'Buyer email: shipped',
  trigger: 'order.shipped',
  triggerConfig: {},
  conditions: [],
  actions: [
    {
      action: 'send-email',
      recipient: { kind: 'buyer' },
      subject: 'Shipped {order.reference}',
      body: 'Hello',
      buyerEmailTemplate: 'shipped',
    },
  ],
  definitionHash: 'h',
  isActive: false,
  effectiveFrom: '2026-10-29',
  effectiveTo: null,
  hasIrreversibleAction: false,
  actionAvailability: [],
  moneyAckByUserId: null,
  moneyAckAt: null,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
};

const session = createAuthenticatedSessionAdapter(ADMIN);

afterEach(cleanup);

describe('BuyerEmailsPage (#3555)', () => {
  it('should be off by default and say the channel already notifies its buyers (list)', async () => {
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([SHOP]) } }),
      sessionAdapter: session,
    });

    const list = await screen.findByTestId('buyer-emails-list');
    expect(list).toHaveAttribute('data-mk-state', 'list');
    expect(screen.getByTestId('buyer-emails-master-switch')).not.toBeChecked();
    expect(screen.getByTestId('buyer-emails-off-note')).toHaveTextContent(
      'The channel already notifies its buyers',
    );
    expect(screen.getAllByTestId('buyer-email-template-row')).toHaveLength(4);
  });

  it('should not offer Order confirmed on a marketplace connection and say why', async () => {
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([MARKETPLACE]) } }),
      sessionAdapter: session,
    });

    await screen.findByTestId('buyer-emails-list');
    const templates = screen
      .getAllByTestId('buyer-email-template-row')
      .map((row) => row.getAttribute('data-template'));
    expect(templates).toEqual(['shipped', 'document-issued', 'return-received']);
    expect(screen.getByTestId('buyer-emails-marketplace-note')).toHaveTextContent('Order confirmed');
  });

  it('should write the master switch into config.buyerEmails and keep other keys', async () => {
    const update = vi.fn().mockResolvedValue(SHOP);
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([SHOP]), update },
      }),
      sessionAdapter: session,
    });

    await userEvent.click(await screen.findByTestId('buyer-emails-master-switch'));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('conn-shop', {
        config: { baseUrl: 'x', buyerEmails: { enabled: true, templates: {} } },
      }),
    );
  });

  it('should show the loading state while connections load (list-loading)', () => {
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockReturnValue(new Promise(() => undefined)) },
      }),
      sessionAdapter: session,
    });

    expect(screen.getByTestId('buyer-emails-loading')).toHaveAttribute('data-mk-state', 'list-loading');
  });
});

function renderEditor(overrides: Parameters<typeof createMockApiClient>[0]): void {
  renderWithProviders(
    <Routes>
      <Route path="/settings/buyer-emails/:connectionId/:template" element={<BuyerEmailEditorPage />} />
      <Route path="/settings/buyer-emails" element={<p>list</p>} />
    </Routes>,
    {
      apiClient: createMockApiClient(overrides),
      route: '/settings/buyer-emails/conn-shop/shipped',
      sessionAdapter: session,
    },
  );
}

const automations = {
  listByTrigger: vi.fn((trigger: string) =>
    Promise.resolve({
      items: trigger === 'order.shipped' ? [SHIPPED_RULE] : [],
      droppedCount: 0,
      envelopeUnreadable: false,
    }),
  ),
};

describe('BuyerEmailEditorPage (#3555)', () => {
  it('should save the connection switch and sender, then the shared wording, activating the rule (editor)', async () => {
    const update = vi.fn().mockResolvedValue(SHOP);
    const replace = vi.fn().mockResolvedValue(SHIPPED_RULE);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update },
      automations: { ...automations, replace },
    });

    const editor = await screen.findByTestId('buyer-email-editor');
    expect(editor).toHaveAttribute('data-mk-state', 'editor');
    expect(screen.getByTestId('buyer-email-subject')).toHaveValue('Shipped {order.reference}');

    await userEvent.click(screen.getByTestId('buyer-email-template-enabled'));
    await userEvent.type(screen.getByTestId('buyer-email-reply-to'), 'help@shop.pl');
    await userEvent.clear(screen.getByTestId('buyer-email-subject'));
    await userEvent.type(screen.getByTestId('buyer-email-subject'), 'On its way');
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith('conn-shop', {
      config: {
        baseUrl: 'x',
        buyerEmails: { enabled: false, templates: { shipped: { enabled: true, replyTo: 'help@shop.pl' } } },
      },
    });
    const [ruleId, write] = replace.mock.calls[0] as [string, { isActive: boolean; actions: unknown[] }];
    expect(ruleId).toBe('rule-shipped');
    expect(write.isActive).toBe(true);
    expect(write.actions[0]).toMatchObject({ subject: 'On its way', buyerEmailTemplate: 'shipped' });
  });

  it('should send a test to the typed address and show it was sent (editor-sent)', async () => {
    const sendTest = vi.fn().mockResolvedValue(undefined);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP) },
      automations,
      buyerEmails: { sendTest },
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.type(screen.getByTestId('buyer-email-test-to'), 'me@shop.pl');
    await userEvent.click(screen.getByTestId('buyer-email-test-send'));

    const sent = await screen.findByTestId('buyer-email-test-sent');
    expect(within(sent).getByText(/me@shop\.pl/)).toBeInTheDocument();
    expect(screen.getByTestId('buyer-email-editor')).toHaveAttribute('data-mk-state', 'editor-sent');
    expect(sendTest).toHaveBeenCalledWith({
      connectionId: 'conn-shop',
      templateKey: 'shipped',
      to: 'me@shop.pl',
      subject: 'Shipped {order.reference}',
      body: 'Hello',
    });
  });
});
