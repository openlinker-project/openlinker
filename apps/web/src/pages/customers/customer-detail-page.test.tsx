import { cleanup, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { CustomerDetailPage } from './customer-detail-page';
import type { CustomerProjectionDetail } from '../../features/customers/api/customers.types';

const sampleCustomer: CustomerProjectionDetail = {
  internalCustomerId: 'ol_customer_abc',
  emailHash: 'hash123',
  normalizedEmail: 'jane@example.com',
  firstName: 'Jane',
  lastName: null,
  lastSeenAt: '2026-04-20T10:00:00.000Z',
  lastSourceConnectionId: sampleConnection.id,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  addresses: [],
};

function renderDetail(apiClient: ReturnType<typeof createMockApiClient>): void {
  renderWithProviders(
    <Routes>
      <Route path="/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { apiClient, route: '/customers/ol_customer_abc' },
  );
}

describe('CustomerDetailPage', () => {
  afterEach(cleanup);

  it('renders customer fields, uses EmptyValue for missing last name, resolves connection', async () => {
    const api = createMockApiClient({
      customers: { getById: vi.fn().mockResolvedValue(sampleCustomer) },
    });

    renderDetail(api);

    await screen.findByText('ol_customer_abc');
    expect(screen.getAllByText('Jane').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('No value').length).toBeGreaterThan(0);

    await screen.findByRole('link', { name: sampleConnection.name });
  });

  it('falls back to EmptyValue for last-source when connectionId is null', async () => {
    const api = createMockApiClient({
      customers: {
        getById: vi.fn().mockResolvedValue({ ...sampleCustomer, lastSourceConnectionId: null }),
      },
    });

    renderDetail(api);

    await screen.findByText('ol_customer_abc');
    expect(screen.queryByRole('link', { name: sampleConnection.name })).toBeNull();
    expect(screen.getAllByLabelText('No value').length).toBeGreaterThanOrEqual(2);
  });
});
