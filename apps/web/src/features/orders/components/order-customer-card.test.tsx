import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderCustomerCard } from './order-customer-card';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import type { CustomerProjectionDetail } from '../../customers/api/customers.types';

const customerWithPii: CustomerProjectionDetail = {
  internalCustomerId: 'ol_customer_abc',
  emailHash: 'sha256_8awgqyk6a5xxxxxxx',
  normalizedEmail: 'jane.doe@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  lastSeenAt: '2026-04-20T10:00:00.000Z',
  lastSourceConnectionId: 'conn_allegro_1',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  addresses: [],
};

const customerHashOnly: CustomerProjectionDetail = {
  ...customerWithPii,
  internalCustomerId: 'ol_customer_hash',
  normalizedEmail: null,
  firstName: null,
  lastName: null,
};

describe('OrderCustomerCard', () => {
  afterEach(cleanup);

  it('renders a muted empty state when customerId is null and never queries the API', () => {
    const getById = vi.fn();
    const list = vi.fn();
    const apiClient = createMockApiClient({
      customers: { list: vi.fn(), getById },
      orders: { list, getById: vi.fn() },
    });

    renderWithProviders(<OrderCustomerCard customerId={null} />, { apiClient });

    expect(
      screen.getByText(/No customer linked/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View failed orders/ })).toBeNull();
    expect(getById).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('adds a "View failed orders" link to the empty state when sourceConnectionId is provided', () => {
    const apiClient = createMockApiClient({
      customers: { list: vi.fn(), getById: vi.fn() },
      orders: { list: vi.fn(), getById: vi.fn() },
    });

    renderWithProviders(
      <OrderCustomerCard customerId={null} sourceConnectionId="conn_allegro_1" />,
      { apiClient },
    );

    const link = screen.getByRole('link', { name: /View failed orders/ });
    expect(link).toHaveAttribute('href', '/orders/failed?connectionId=conn_allegro_1');
  });

  it('renders the loading skeleton shell while the customer query is pending', () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_abc" />, { apiClient });

    const card = screen.getByLabelText('Customer');
    expect(card).toHaveAttribute('aria-busy', 'true');
  });

  it('renders the error state with a Retry action when the customer query fails', async () => {
    const user = userEvent.setup();
    const getById = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(customerWithPii);
    const apiClient = createMockApiClient({
      customers: { list: vi.fn(), getById },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_abc" />, { apiClient });

    expect(await screen.findByText(/Couldn’t load customer details/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(getById).toHaveBeenCalledTimes(2);
  });

  it('renders full name and normalized email under raw PII mode', async () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(customerWithPii),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 1, limit: 1, offset: 0 }),
        getById: vi.fn(),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_abc" />, { apiClient });

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane.doe@example.com')).toBeInTheDocument();
    const viewCustomer = screen.getByRole('link', { name: 'View customer' });
    expect(viewCustomer).toHaveAttribute('href', '/customers/ol_customer_abc');
  });

  it('falls back to an email-hash chip + "Unknown name" under PII hash-only mode', async () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(customerHashOnly),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 1, limit: 1, offset: 0 }),
        getById: vi.fn(),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_hash" />, { apiClient });

    expect(await screen.findByText('Unknown name')).toBeInTheDocument();
    // Hash chip renders first N chars + ellipsis
    expect(screen.getByText(/^sha256_8aw/)).toBeInTheDocument();
    expect(screen.queryByText('jane.doe@example.com')).toBeNull();
  });

  it('shows the "Previous orders" row when the customer has more than one order', async () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(customerWithPii),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 4, limit: 1, offset: 0 }),
        getById: vi.fn(),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_abc" />, { apiClient });

    expect(await screen.findByText('Previous orders')).toBeInTheDocument();
    // total = 4 including this order → 3 previous
    expect(screen.getByRole('link', { name: '3' })).toBeInTheDocument();
  });

  it('omits the "Previous orders" row when the customer has exactly one order', async () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(customerWithPii),
      },
      orders: {
        list: vi.fn().mockResolvedValue({ items: [], total: 1, limit: 1, offset: 0 }),
        getById: vi.fn(),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_abc" />, { apiClient });

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Previous orders')).toBeNull();
  });

  it('shows a "record not found" muted message when the customer query resolves null', async () => {
    const apiClient = createMockApiClient({
      customers: {
        list: vi.fn(),
        getById: vi.fn().mockResolvedValue(null),
      },
    });

    renderWithProviders(<OrderCustomerCard customerId="ol_customer_missing" />, { apiClient });

    expect(await screen.findByText(/Customer record not found/)).toBeInTheDocument();
  });
});
