/**
 * AmazonSetupPage tests (#4186)
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthenticatedSessionAdapter, renderWithProviders } from '../../test/test-utils';
import { AmazonSetupPage } from './amazon-setup-page';

describe('AmazonSetupPage', () => {
  afterEach(cleanup);

  it('should show the form to a session that may create connections', async () => {
    renderWithProviders(<AmazonSetupPage />, { sessionAdapter: createAuthenticatedSessionAdapter() });

    expect(await screen.findByRole('button', { name: 'Create connection' })).toBeInTheDocument();
  });

  it('should explain read-only access instead of showing the form', async () => {
    const viewer = createAuthenticatedSessionAdapter({
      id: 'u-viewer',
      username: 'viewer',
      email: null,
      role: 'viewer',
      permissions: ['connections:read'],
    });
    renderWithProviders(<AmazonSetupPage />, { sessionAdapter: viewer });

    expect(await screen.findByText('Read-only access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create connection' })).toBeNull();
  });
});
