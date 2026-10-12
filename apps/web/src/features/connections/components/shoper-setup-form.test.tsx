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

describe('ShoperSetupForm', () => {
  afterEach(cleanup);

  it('starts on the shop step', () => {
    renderWithProviders(<ShoperSetupForm />);
    expect(screen.getByLabelText('Connection name')).toBeInTheDocument();
    expect(screen.getByLabelText('Shop address')).toBeInTheDocument();
    expect(screen.queryByLabelText('API token')).toBeNull();
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

    expect(screen.getByLabelText('ProductMaster')).toBeChecked();
    expect(screen.getByLabelText('InventoryMaster')).toBeChecked();
    expect(screen.getByLabelText('OrderProcessorManager')).not.toBeChecked();
    expect(screen.getByLabelText('OrderSource')).not.toBeChecked();
  });

  it('shows a masked token and the chosen capabilities on the review step', async () => {
    renderWithProviders(<ShoperSetupForm />);
    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText('OrderSource'));
    next();

    expect(await screen.findByText('••••••3456')).toBeInTheDocument();
    expect(screen.queryByText('tok_123456')).toBeNull();
    expect(screen.getByText(/ProductMaster, InventoryMaster, OrderSource/)).toBeInTheDocument();
  });

  it('submits the create payload with the chosen capabilities', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText('OrderSource'));
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

  it('shows the server error when create is rejected', async () => {
    const create = vi.fn().mockRejectedValue(new Error('Shop address must use https'));
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText(/must use https/)).toBeInTheDocument();
  });

  it('points to the order defaults only when the shop will receive orders', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'conn-1', name: 'My Shoper' });
    renderWithProviders(<ShoperSetupForm />, {
      apiClient: createMockApiClient({ connections: { create } }),
    });

    await fillShopStep();
    await fillTokenStep();
    fireEvent.click(screen.getByLabelText('OrderProcessorManager'));
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
