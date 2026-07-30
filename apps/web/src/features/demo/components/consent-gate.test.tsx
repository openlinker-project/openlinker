import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../../app/api/api-client';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ConsentGate, resolveNextPath } from './consent-gate';

function renderGate(search: string, apiClient: ApiClient = createMockApiClient({})): void {
  renderWithProviders(
    <Routes>
      <Route path="/consent" element={<ConsentGate />} />
      <Route path="/orders" element={<p>Orders page</p>} />
      <Route path="/" element={<p>Dashboard page</p>} />
      <Route path="/login" element={<p>Login page</p>} />
    </Routes>,
    { apiClient, route: `/consent${search}` },
  );
}

describe('resolveNextPath', () => {
  it.each([
    [null, '/'],
    ['', '/'],
    ['/orders', '/orders'],
    ['/orders?status=failed', '/orders?status=failed'],
    // An absolute or protocol-relative target would turn the gate into an open
    // redirect, so both fall back to the app root.
    ['https://evil.example/steal', '/'],
    ['//evil.example/steal', '/'],
  ])('should resolve %s to %s', (raw, expected) => {
    expect(resolveNextPath(raw)).toBe(expected);
  });
});

describe('ConsentGate', () => {
  afterEach(cleanup);

  it('should offer exactly two ways forward: agree, or sign out', () => {
    renderGate('');

    expect(screen.getByRole('button', { name: /agree and continue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('should disclose what is recorded behind a collapsed summary', async () => {
    renderGate('');

    await userEvent.click(screen.getByText(/what we record/i));

    expect(screen.getByText(/text you type, except passwords/i)).toBeInTheDocument();
  });

  it('should persist consent and return to the originally requested path', async () => {
    const updateAnalyticsConsent = vi.fn().mockResolvedValue({ analyticsConsent: true });
    const apiClient = createMockApiClient({ auth: { updateAnalyticsConsent } });

    renderGate('?next=%2Forders', apiClient);
    await userEvent.click(screen.getByRole('button', { name: /agree and continue/i }));

    await waitFor(() => expect(screen.getByText('Orders page')).toBeInTheDocument());
    expect(updateAnalyticsConsent).toHaveBeenCalledWith({ analyticsConsent: true });
  });

  it('should stay on the page and surface the failure when the write fails', async () => {
    const apiClient = createMockApiClient({
      auth: { updateAnalyticsConsent: vi.fn().mockRejectedValue(new Error('Network down')) },
    });

    renderGate('?next=%2Forders', apiClient);
    await userEvent.click(screen.getByRole('button', { name: /agree and continue/i }));

    expect(await screen.findByText(/network down/i)).toBeInTheDocument();
    expect(screen.queryByText('Orders page')).not.toBeInTheDocument();
  });

  it('should send the visitor to the login page after signing out', async () => {
    renderGate('');

    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(screen.getByText('Login page')).toBeInTheDocument());
  });
});
