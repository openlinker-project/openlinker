/**
 * ShoperSetupForm Tests
 *
 * Coverage for the 4-step Shoper setup wizard: per-step validation, capability
 * selection, review content, the create payload, and the post-create
 * "Test connection" flow with the order-defaults pointer.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockApiClient,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';
import { ShoperSetupForm } from './shoper-setup-form';
import { getMessages } from '../../../shared/i18n';

vi.mock('../../demo', () => ({ captureDemoEvent: vi.fn() }));

function next(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}

async function fillShopStep(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'My Shoper' } });
  fireEvent.change(screen.getByLabelText('Shop address'), {
    target: { value: 'https://myshop.shoparena.pl' },
  });
  next();
  await screen.findByLabelText('API token');
}

async function fillTokenStep(): Promise<void> {
  fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok_123456' } });
  next();
  await screen.findByRole('group', { name: 'Capabilities' });
}

async function reachReview(): Promise<void> {
  await fillShopStep();
  await fillTokenStep();
  next();
  await screen.findByRole('button', { name: 'Create connection' });
}

const SHOPER_WITH_ORDER_START = [
  {
    adapterKey: 'shoper.restapi.v1',
    platformType: 'shoper',
    supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource'],
    orderSyncStartModes: ['now', 'from', 'all'],
    orderWindowImport: true,
  },
];

async function reachOrdersStep(adapters: unknown = SHOPER_WITH_ORDER_START, create = vi.fn()) {
  renderWithProviders(<ShoperSetupForm />, {
    apiClient: createMockApiClient({
      connections: { create },
      adapters: { list: vi.fn().mockResolvedValue(adapters) },
    }),
  });
  await fillShopStep();
  await fillTokenStep();
  fireEvent.click(screen.getByLabelText(/OrderSource/));
  next();
  return create;
}

describe('ShoperSetupForm', () => {
  afterEach(cleanup);

  it('starts on the shop step', () => {
    renderWithProviders(<ShoperSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Shop address')).toBeInTheDocument();
    expect(screen.queryByLabelText('API token')).toBeNull();
  });

  it('should show plain labels with the code name and an order-history hint on the capabilities step', async () => {
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({
        adapters: { list: vi.fn().mockResolvedValue(SHOPER_WITH_ORDER_START) },
      }),
    });
    await fillShopStep();
    await fillTokenStep();
    expect(screen.getByText('Order source')).toBeInTheDocument();
    expect(screen.getByText('OrderSource')).toBeInTheDocument();
    expect(
      screen.getByText('Next you will choose which past orders to import.')
    ).toBeInTheDocument();
  });

  it('should highlight the new order-history step when OrderSource is ticked', async () => {
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({
        adapters: { list: vi.fn().mockResolvedValue(SHOPER_WITH_ORDER_START) },
      }),
    });
    await fillShopStep();
    await fillTokenStep();
    expect(document.querySelector('.setup-stepper__step--new')).toBeNull();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    const highlighted = document.querySelector('.setup-stepper__step--new');
    expect(highlighted).toHaveTextContent('Order history');
  });

  it('refuses to leave the shop step without a name and an address', async () => {
    renderWithProviders(<ShoperSetupForm />);
    next();

    expect(await screen.findByText('Connection name is required')).toBeInTheDocument();
    expect(screen.getByText('Shop address is required')).toBeInTheDocument();
    expect(screen.queryByLabelText('API token')).toBeNull();
  });

  it('refuses to leave the token step without a token', async () => {
    renderWithProviders(<ShoperSetupForm />);
    await fillShopStep();
    next();

    expect(await screen.findByText('API token is required')).toBeInTheDocument();
  });

  it('pre-selects only the catalogue and stock roles, leaving orders opt-in', async () => {
    renderWithProviders(<ShoperSetupForm />);
    await fillShopStep();
    await fillTokenStep();

    expect(screen.getByLabelText(/ProductMaster/)).toBeChecked();
    expect(screen.getByLabelText(/InventoryMaster/)).toBeChecked();
    expect(screen.getByLabelText(/OrderProcessorManager/)).not.toBeChecked();
    expect(screen.getByLabelText(/OrderSource/)).not.toBeChecked();
  });

  it('shows a masked token and the chosen capabilities on the review step', async () => {
    renderWithProviders(<ShoperSetupForm />);
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();
    await screen.findByText('Which orders should OpenLinker import?');
    next();

    expect(await screen.findByText('••••••3456')).toBeInTheDocument();
    expect(screen.queryByText('tok_123456')).toBeNull();
    expect(screen.getByText(/ProductMaster, InventoryMaster, OrderSource/)).toBeInTheDocument();
  });

  it('should show the review step instead of creating when the form is submitted before the last step', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });
    await fillShopStep();
    await fillTokenStep();

    const form = screen.getByRole('button', { name: 'Next' }).closest('form');
    if (!form) throw new Error('wizard form not found');
    fireEvent.submit(form);

    expect(await screen.findByRole('button', { name: 'Create connection' })).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('should advance one step and create nothing when Enter is pressed in the token field', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });
    await fillShopStep();
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'tok_123456' } });

    const form = screen.getByLabelText('API token').closest('form');
    if (!form) throw new Error('wizard form not found');
    fireEvent.submit(form);

    expect(await screen.findByRole('group', { name: 'Capabilities' })).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('submits the create payload with the chosen capabilities', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();
    await screen.findByText('Which orders should OpenLinker import?');
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: 'My Shoper',
        platformType: 'shoper',
        adapterKey: 'shoper.restapi.v1',
        credentials: { token: 'tok_123456' },
        config: { baseUrl: 'https://myshop.shoparena.pl' },
        enabledCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource'],
      });
    });
    expect(await findToastTitle('Connection created')).toBeInTheDocument();
  });

  it('has no order-history step while OrderSource is off', async () => {
    renderWithProviders(<ShoperSetupForm />);
    await reachReview();

    expect(screen.queryByText('Order history')).toBeNull();
    expect(screen.queryByText('Orders since a date')).toBeNull();
  });

  it('adds an order-history step for OrderSource, defaulting to new orders only', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();

    expect(await screen.findByRole('radio', { name: /New orders only/ })).toBeChecked();
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0][0] as { orderSyncStart?: unknown }).orderSyncStart).toBeUndefined();
  });

  it('sends the chosen start and states it on the review step (#4265)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({
        connections: { create },
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shoper.restapi.v1',
              platformType: 'shoper',
              supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
              orderWindowImport: true,
            },
          ]),
        },
      }),
    });
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();

    fireEvent.click(await screen.findByRole('radio', { name: /Every order the shop has/ }));
    next();
    expect(await screen.findAllByText('Every order')).not.toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ orderSyncStart: { mode: 'all' } }),
      ),
    );
  });

  it('refuses a start date in the future', async () => {
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({
        adapters: {
          list: vi.fn().mockResolvedValue([
            {
              adapterKey: 'shoper.restapi.v1',
              platformType: 'shoper',
              supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource'],
              orderSyncStartModes: ['now', 'from', 'all'],
            },
          ]),
        },
      }),
    });
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();

    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    fireEvent.change(screen.getByLabelText('First day to import'), {
      target: { value: '2999-01-01' },
    });
    next();

    expect(await screen.findByText('Which orders should OpenLinker import?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create connection' })).toBeNull();
  });

  it('sends a start date and newest-first when the shop declares the date start and window import', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    await reachOrdersStep(SHOPER_WITH_ORDER_START, create);

    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    fireEvent.change(screen.getByLabelText('First day to import'), { target: { value: '2024-03-01' } });
    fireEvent.click(screen.getByRole('radio', { name: /Newest first/ }));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderSyncStart: { mode: 'from', from: '2024-03-01', order: 'newest-first' },
        }),
      ),
    );
  });

  it('does not offer modes the shop does not declare', async () => {
    await reachOrdersStep([{ ...SHOPER_WITH_ORDER_START[0], orderSyncStartModes: ['now'], orderWindowImport: false }]);

    const fromCard = await screen.findByRole('radio', { name: /Orders since a date/ });
    expect(fromCard).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: /Every order the shop has/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows a loading line, not a disabled date card, while the adapter list loads', async () => {
    await reachOrdersStep(new Promise(() => undefined));

    expect(await screen.findByText(getMessages('connections').orderSyncStart.loading)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Orders since a date/ })).toBeNull();
  });

  it('says the start will be new orders only when the adapter list cannot be read', async () => {
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ adapters: { list: vi.fn().mockRejectedValue(new Error('down')) } }),
    });
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderSource/));
    next();

    expect(await screen.findByText(getMessages('connections').orderSyncStart.loadFailed)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Orders since a date/ })).toBeNull();
  });

  it('does not let a start date nobody can see block the submit', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    await reachOrdersStep(SHOPER_WITH_ORDER_START, create);

    // Pick "from" with no day, leave the step, then untick OrderSource: the step is gone.
    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByLabelText(/OrderSource/));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect((create.mock.calls[0][0] as { orderSyncStart?: unknown }).orderSyncStart).toBeUndefined();
  });

  it('explains a refused start date in the error summary instead of failing silently', async () => {
    await reachOrdersStep(SHOPER_WITH_ORDER_START);

    fireEvent.click(await screen.findByRole('radio', { name: /Orders since a date/ }));
    next();

    expect(await screen.findByText(getMessages('connections').orderSyncStartSchema.dateRequired)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create connection' })).toBeNull();
  });

  it('marks steps done by what they are, not by their position, when OrderSource is removed', async () => {
    await reachOrdersStep(SHOPER_WITH_ORDER_START);
    // Visit and complete the order step, so it is recorded as done.
    await screen.findByRole('radio', { name: /New orders only/ });
    next();
    await screen.findByRole('button', { name: 'Create connection' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByLabelText(/OrderSource/));

    // Without the order step the review step takes its index; it must not inherit its done mark.
    const steps = Array.from(document.querySelectorAll('.setup-stepper__list .setup-stepper__step'));
    const review = steps.find((step) => step.textContent?.includes('Review & create'));
    expect(steps.some((step) => step.textContent?.includes('Order history'))).toBe(false);
    expect(review?.className).toContain('setup-stepper__step--upcoming');
  });

  it('shows the server error when create is rejected', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Shop address must use https'));
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText(getMessages('errors').status.other)).toBeInTheDocument();
  });

  it('points to the order defaults only when the shop will receive orders', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText(/OrderProcessorManager/));
    next();
    fireEvent.click(await screen.findByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('One more step to receive orders')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the connection settings' })).toHaveAttribute(
      'href',
      '/connections/conn-1/edit',
    );
  });

  it('does not mention order defaults when orders are not received', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    await screen.findByRole('button', { name: 'Test connection' });
    expect(screen.queryByText('One more step to receive orders')).toBeNull();
  });

  it('surfaces a passing, a failing and a rejected test-connection result without a stale one', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    const test = vi
      .fn()
      .mockResolvedValueOnce({ success: true, status: 200, message: 'OK', latencyMs: 42 })
      .mockResolvedValueOnce({ success: false, status: 401, message: 'Unauthorized', latencyMs: 10 })
      .mockRejectedValueOnce(new Error('Network unreachable'));
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create, test } }),
    });

    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));
    const testButton = await screen.findByRole('button', { name: 'Test connection' });

    fireEvent.click(testButton);
    expect(await screen.findByText('Connection test passed')).toBeInTheDocument();
    await waitFor(() => expect(test).toHaveBeenCalledWith('conn-1'));

    fireEvent.click(testButton);
    expect(await screen.findByText('Connection test failed')).toBeInTheDocument();
    expect(screen.getByText(/Unauthorized/)).toBeInTheDocument();

    fireEvent.click(testButton);
    expect(await screen.findByText('Unable to test connection')).toBeInTheDocument();
    expect(screen.queryByText('Connection test failed')).not.toBeInTheDocument();
  });
});
