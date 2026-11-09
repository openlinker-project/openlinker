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
import { ApiError } from '../../shared/api/api-error';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuyerEmailsPage } from './buyer-emails-page';
import { BuyerEmailEditorPage } from './buyer-email-editor-page';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  findToastDescription,
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

const OPERATOR: SessionUser = {
  ...ADMIN,
  id: 'user_2',
  username: 'operator',
  role: 'operator',
  permissions: ['orders:read', 'orders:write', 'connections:read'],
};

afterEach(cleanup);

describe('BuyerEmailsPage (#3555)', () => {
  it('should state the page is admin-only for a session without connections:write', async () => {
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({ connections: { list: vi.fn().mockResolvedValue([SHOP]) } }),
      sessionAdapter: createAuthenticatedSessionAdapter(OPERATOR),
    });

    expect(
      await screen.findByText('Only an administrator can change buyer emails.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('buyer-emails-list')).not.toBeInTheDocument();
  });

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
        connections: {
          list: vi.fn().mockResolvedValue([SHOP]),
          getById: vi.fn().mockResolvedValue(SHOP),
          update,
        },
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

  it('should show a template whose seeded rule is missing as not available, never as on', async () => {
    const withShippedOn: Connection = {
      ...SHOP,
      config: { buyerEmails: { enabled: true, templates: { shipped: { enabled: true } } } },
    };
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockResolvedValue([withShippedOn]) },
        automations: {
          listByTrigger: vi.fn((trigger: string) =>
            Promise.resolve({
              items: trigger === 'order.shipped' ? [] : [SHIPPED_RULE],
              droppedCount: 0,
              envelopeUnreadable: false,
            }),
          ),
        },
      }),
      sessionAdapter: session,
    });

    await screen.findByTestId('buyer-emails-list');
    const shipped = screen
      .getAllByTestId('buyer-email-template-row')
      .find((row) => row.getAttribute('data-template') === 'shipped');
    if (!shipped) throw new Error('no shipped row');
    await waitFor(() =>
      expect(within(shipped).getByText('Not available (ready-made rule missing)')).toBeInTheDocument(),
    );
    expect(within(shipped).queryByText('On')).toBeNull();
  });

  it('should show the loading state while connections load (list-loading)', async () => {
    renderWithProviders(<BuyerEmailsPage />, {
      apiClient: createMockApiClient({
        connections: { list: vi.fn().mockReturnValue(new Promise(() => undefined)) },
      }),
      sessionAdapter: session,
    });

    // AccessGate renders nothing until the session hydrates, so wait for it.
    expect(await screen.findByTestId('buyer-emails-loading')).toHaveAttribute(
      'data-mk-state',
      'list-loading',
    );
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
  get: vi.fn().mockResolvedValue(SHIPPED_RULE),
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

  it('should build the rule write from a fresh read, never from the copy the editor loaded', async () => {
    // Loaded active; since then someone switched it off in the automation
    // composer and added a condition. A save of a disabled template must keep both.
    const loaded: AutomationRule = { ...SHIPPED_RULE, isActive: true };
    const fresh: AutomationRule = {
      ...SHIPPED_RULE,
      isActive: false,
      conditions: [{ field: 'orderTotalGross', operator: 'gte', amount: '100', currency: 'PLN' }],
    };
    const replace = vi.fn().mockResolvedValue(fresh);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update: vi.fn().mockResolvedValue(SHOP) },
      automations: {
        listByTrigger: vi.fn().mockResolvedValue({ items: [loaded], droppedCount: 0, envelopeUnreadable: false }),
        get: vi.fn().mockResolvedValue(fresh),
        replace,
      },
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.clear(screen.getByTestId('buyer-email-subject'));
    await userEvent.type(screen.getByTestId('buyer-email-subject'), 'On its way');
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    await waitFor(() => expect(replace).toHaveBeenCalled());
    const [, write] = replace.mock.calls[0] as [string, { isActive: boolean; conditions: unknown[] }];
    expect(write.isActive).toBe(false);
    expect(write.conditions).toEqual(fresh.conditions);
  });

  it('should report a failed rules read as a load error with a retry, not as a missing rule', async () => {
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP) },
      automations: { listByTrigger: vi.fn().mockRejectedValue(new Error('500')) },
    });

    expect(await screen.findByText('Could not load this email')).toBeInTheDocument();
    expect(screen.getByTestId('buyer-email-rules-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('buyer-email-editor')).not.toBeInTheDocument();
    expect(screen.queryByText(/ready-made rule for this email is missing/)).not.toBeInTheDocument();
  });

  it('should say the sender was saved but the wording was not when only the rule write fails', async () => {
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update: vi.fn().mockResolvedValue(SHOP) },
      automations: { ...automations, replace: vi.fn().mockRejectedValue(new Error('Server error')) },
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    expect(
      await screen.findByText(
        'The switch and sender were saved, but the subject and message were not. Server error',
      ),
    ).toBeInTheDocument();
  });

  it('should send a test to the typed address and show it was sent (editor-sent)', async () => {
    const sendTest = vi.fn().mockResolvedValue(undefined);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP) },
      automations,
      buyerEmails: { sendTest },
    });

    await screen.findByTestId('buyer-email-editor');
    // Prefilled with the operator's own address; replace it with another one.
    expect(screen.getByTestId('buyer-email-test-to')).toHaveValue('admin@example.com');
    await userEvent.clear(screen.getByTestId('buyer-email-test-to'));
    await userEvent.type(screen.getByTestId('buyer-email-test-to'), 'me@shop.pl');
    await userEvent.click(screen.getByTestId('buyer-email-test-send'));

    const sent = await screen.findByTestId('buyer-email-test-sent');
    expect(within(sent).getByText(/me@shop\.pl/)).toBeInTheDocument();
    expect(screen.getByTestId('buyer-email-editor')).toHaveAttribute('data-mk-state', 'editor-sent');
    expect(sendTest).toHaveBeenCalledWith({
      connectionId: 'conn-shop',
      templateKey: 'shipped',
      to: 'me@shop.pl',
      // The test matches the preview: variables carry sample values.
      subject: 'Shipped SHOP-4821',
      body: 'Hello',
    });
  });

  it('should show a sender the server refuses as the save error', async () => {
    const update = vi.fn().mockRejectedValue(
      new ApiError(
        'config.buyerEmails: fromAddress of "shipped" must be a single email address',
        400,
        null,
      ),
    );
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update },
      automations,
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.type(screen.getByTestId('buyer-email-from'), 'shop@x.pl');
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    expect(
      await screen.findByText(
        'Nothing was saved. config.buyerEmails: fromAddress of "shipped" must be a single email address',
      ),
    ).toBeInTheDocument();
  });

  it('should block the test send while the sender has unsaved edits, since the test uses the saved sender', async () => {
    const sendTest = vi.fn().mockResolvedValue(undefined);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP) },
      automations,
      buyerEmails: { sendTest },
    });

    await screen.findByTestId('buyer-email-editor');
    expect(screen.getByTestId('buyer-email-test-send')).toBeEnabled();

    await userEvent.type(screen.getByTestId('buyer-email-from'), 'new@shop.pl');

    expect(screen.getByTestId('buyer-email-test-send')).toBeDisabled();
    expect(screen.getByTestId('buyer-email-test-sender-unsaved')).toHaveTextContent(
      'Save your sender and reply-to changes first',
    );

    await userEvent.clear(screen.getByTestId('buyer-email-from'));

    expect(screen.getByTestId('buyer-email-test-send')).toBeEnabled();
    expect(screen.queryByTestId('buyer-email-test-sender-unsaved')).toBeNull();
  });

  it('should unblock the test send once a save stored the sender, even if the wording failed', async () => {
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update: vi.fn().mockResolvedValue(SHOP) },
      automations: { ...automations, replace: vi.fn().mockRejectedValue(new Error('Server error')) },
      buyerEmails: { sendTest: vi.fn().mockResolvedValue(undefined) },
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.type(screen.getByTestId('buyer-email-from'), 'new@shop.pl');
    expect(screen.getByTestId('buyer-email-test-send')).toBeDisabled();

    await userEvent.click(screen.getByTestId('buyer-email-save'));
    await findToastDescription(/the subject and message were not/);

    expect(screen.getByTestId('buyer-email-from')).toHaveValue('new@shop.pl');
    expect(screen.getByTestId('buyer-email-test-send')).toBeEnabled();
    expect(screen.queryByTestId('buyer-email-test-sender-unsaved')).toBeNull();
  });

  it('should not save an empty subject', async () => {
    const update = vi.fn().mockResolvedValue(SHOP);
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update },
      automations,
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.clear(screen.getByTestId('buyer-email-subject'));
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    expect(await screen.findByText('Enter a subject.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('should not let a template without its seeded rule be switched on, and still save the sender', async () => {
    const update = vi.fn().mockResolvedValue(SHOP);
    const replace = vi.fn();
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP), update },
      automations: {
        listByTrigger: vi.fn().mockResolvedValue({ items: [], droppedCount: 0, envelopeUnreadable: false }),
        replace,
      },
    });

    await screen.findByTestId('buyer-email-editor');
    expect(screen.getByTestId('buyer-email-template-enabled')).toBeDisabled();
    expect(screen.getByText(/cannot be switched on/)).toBeInTheDocument();

    await userEvent.type(screen.getByTestId('buyer-email-reply-to'), 'help@shop.pl');
    await userEvent.click(screen.getByTestId('buyer-email-save'));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('conn-shop', {
        config: {
          baseUrl: 'x',
          buyerEmails: { enabled: false, templates: { shipped: { enabled: false, replyTo: 'help@shop.pl' } } },
        },
      }),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('should explain a rate-limited test send from its code, not the server sentence', async () => {
    const sendTest = vi.fn().mockRejectedValue(
      new ApiError('server wording', 429, {
        statusCode: 429,
        error: 'BUYER_EMAIL_TEST_RATE_LIMITED',
        message: 'server wording',
      }),
    );
    renderEditor({
      connections: { getById: vi.fn().mockResolvedValue(SHOP) },
      automations,
      buyerEmails: { sendTest },
    });

    await screen.findByTestId('buyer-email-editor');
    await userEvent.click(screen.getByTestId('buyer-email-test-send'));

    expect(
      await screen.findByText('Too many test emails in a short time. Wait a few minutes and try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('server wording')).toBeNull();
    expect(screen.queryByTestId('buyer-email-test-sent')).toBeNull();
  });
});
