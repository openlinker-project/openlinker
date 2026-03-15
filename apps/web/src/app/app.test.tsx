import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './app';
import { AppProviders } from './providers/app-providers';

describe('App', () => {
  it('renders the frontend foundation shell', async () => {
    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Integrations/ })).toBeInTheDocument();
  });
});
