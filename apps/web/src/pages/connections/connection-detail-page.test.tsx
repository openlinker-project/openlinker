import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../test/test-utils';
import { ConnectionDetailPage } from './connection-detail-page';

// Note: renderWithProviders uses MemoryRouter. The page reads connectionId via
// useParams which defaults to '' when no route pattern matches. To provide the
// param, we pass the route option so MemoryRouter starts at the right path.
// The query hook is enabled when connectionId.length > 0, so we rely on the
// fallback param value from useParams ({ connectionId = '' }).
//
// However, without a <Route path=":connectionId"> wrapper, useParams returns {}.
// We work around this by testing the page component through the route definition
// using a Route wrapper inside test-utils. Since page tests cannot import from
// app/, we test the rendered output at the feature component level and keep
// page-level tests limited to what renderWithProviders supports.

describe('ConnectionDetailPage', () => {
  afterEach(cleanup);

  it('renders the page layout', () => {
    renderWithProviders(<ConnectionDetailPage />);
    expect(screen.getByText(/Integration detail/)).toBeInTheDocument();
  });

  it('shows empty state when connectionId is not provided', async () => {
    const apiClient = createMockApiClient({
      connections: { getById: vi.fn().mockResolvedValue(null) },
    });
    renderWithProviders(<ConnectionDetailPage />, { apiClient });

    // With no route params, connectionId defaults to '' and query is disabled
    expect(await screen.findByRole('heading', { name: 'Connection not found' })).toBeInTheDocument();
  });

  it('organizes the detail surface into Overview / Health / Actions / Config tabs', async () => {
    const user = userEvent.setup();
    const apiClient = createMockApiClient();

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
      </Routes>,
      { apiClient, route: `/connections/${sampleConnection.id}` },
    );

    await screen.findByRole('heading', { name: 'Overview' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Health' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Config' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Config' }));
    expect(screen.getByRole('tab', { name: 'Config' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Connection config')).toBeInTheDocument();
  });

  it('honors ?tab=config in the URL on first render', async () => {
    const apiClient = createMockApiClient();

    renderWithProviders(
      <Routes>
        <Route path="/connections/:connectionId" element={<ConnectionDetailPage />} />
      </Routes>,
      { apiClient, route: `/connections/${sampleConnection.id}?tab=config` },
    );

    const configTab = await screen.findByRole('tab', { name: 'Config' });
    expect(configTab).toHaveAttribute('aria-selected', 'true');
  });
});
