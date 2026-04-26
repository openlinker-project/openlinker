/**
 * AI Provider Status Card — Unit Tests
 *
 * Verifies the three resolution sources (`db` / `env` / `none`) and the
 * `provider=fake` case render distinct, non-color-only signals so the
 * card stays accessible.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AiProviderStatusCard } from './ai-provider-status-card';

afterEach(cleanup);

describe('AiProviderStatusCard', () => {
  it('renders source=db with the "Stored encrypted" label and success tone', () => {
    render(
      <AiProviderStatusCard
        view={{ provider: 'anthropic', configured: true, source: 'db' }}
      />,
    );

    expect(screen.getByText('Stored encrypted')).toBeInTheDocument();
    expect(screen.getByText('Stored encrypted').closest('.status-badge')).toHaveClass(
      'status-badge--success',
    );
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('renders source=env with the deprecated label and warning tone', () => {
    render(
      <AiProviderStatusCard
        view={{ provider: 'anthropic', configured: true, source: 'env' }}
      />,
    );

    expect(screen.getByText('Env fallback (deprecated)')).toBeInTheDocument();
    expect(
      screen.getByText('Env fallback (deprecated)').closest('.status-badge'),
    ).toHaveClass('status-badge--warning');
  });

  it('renders source=none with the "Not configured" label and neutral tone', () => {
    render(
      <AiProviderStatusCard
        view={{ provider: 'anthropic', configured: false, source: 'none' }}
      />,
    );

    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByText('Not configured').closest('.status-badge')).toHaveClass(
      'status-badge--neutral',
    );
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders the fake provider as configured=No / source=Not configured', () => {
    render(
      <AiProviderStatusCard
        view={{ provider: 'fake', configured: false, source: 'none' }}
      />,
    );

    expect(screen.getByText('fake')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });
});
