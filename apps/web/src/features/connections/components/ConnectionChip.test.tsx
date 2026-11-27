import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionChip } from './ConnectionChip';
import { SYSTEM_CONNECTION_ID } from '../api/connections.types';
import { renderWithProviders } from '../../../test/test-utils';

const CONNECTION_ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';
const CHANNEL = { platformType: 'erli', label: 'Erli' };

describe('ConnectionChip', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render the connection name on the face and the platform in the slide-out of one link', () => {
    renderWithProviders(
      <ConnectionChip connectionId={CONNECTION_ID} name="Erli Demo" channel={CHANNEL} />,
    );

    const link = screen.getByRole('link', { name: 'Erli Demo, Erli' });
    expect(link).toHaveAttribute('href', `/connections/${CONNECTION_ID}`);
    expect(link).toHaveClass('connection-chip--name-first');
    expect(link.querySelector('.connection-chip__face')).toHaveTextContent(/^Erli Demo$/);
    // The platform stays in the DOM; only its visibility is animated on hover.
    expect(link.querySelector('.connection-chip__reveal')).toHaveTextContent(/^Erli$/);
    expect(link).toHaveAttribute('data-channel', 'erli');
    expect(link).toHaveAttribute('title', 'Erli Demo - Erli');
  });

  it('should show the registry short label in the slide-out and the full label in the title when one is declared', () => {
    renderWithProviders(
      <ConnectionChip
        connectionId={CONNECTION_ID}
        name="Subiekt GT Demo"
        channel={{
          platformType: 'subiekt-gt',
          label: 'Subiekt GT (Sfera GT bridge)',
          shortLabel: 'Subiekt GT',
        }}
      />,
    );

    const link = screen.getByRole('link');
    expect(link.querySelector('.connection-chip__reveal')).toHaveTextContent(/^Subiekt GT$/);
    expect(link).toHaveAttribute('title', 'Subiekt GT Demo - Subiekt GT (Sfera GT bridge)');
  });

  it('should keep the full label in the slide-out when no short label is declared', () => {
    renderWithProviders(
      <ConnectionChip
        connectionId={CONNECTION_ID}
        name="KSeF Demo"
        channel={{ platformType: 'ksef', label: 'KSeF (e-invoicing)' }}
      />,
    );

    expect(screen.getByRole('link').querySelector('.connection-chip__reveal')).toHaveTextContent(
      /^KSeF \(e-invoicing\)$/,
    );
  });

  it('should tell a sandbox connection apart from its production twin on the face', () => {
    renderWithProviders(
      <>
        <ConnectionChip
          connectionId={CONNECTION_ID}
          name="Allegro main"
          channel={{ platformType: 'allegro', label: 'Allegro', environment: 'production' }}
        />
        <ConnectionChip
          connectionId="bb966882-0d21-4e2f-9d5a-71c4a5f14cfb"
          name="Allegro test"
          channel={{ platformType: 'allegro', label: 'Allegro', environment: 'sandbox' }}
        />
      </>,
    );

    const production = screen.getByRole('link', { name: 'Allegro main, Allegro' });
    const sandbox = screen.getByRole('link', { name: 'Allegro test, Allegro (sandbox)' });
    expect(production.querySelector('.connection-chip__env')).toBeNull();
    expect(sandbox.querySelector('.connection-chip__env')).toHaveTextContent(/^sandbox$/);
    expect(sandbox.querySelector('.connection-chip__face')).toHaveTextContent(/^Allegro testsandbox$/);
    expect(sandbox.querySelector('.connection-chip__reveal')).toHaveTextContent(/^Allegro \(sandbox\)$/);
    expect(sandbox).toHaveAttribute('title', 'Allegro test - Allegro (sandbox)');
  });

  it('should keep the platform on the face when the surface already prints the name', () => {
    renderWithProviders(
      <ConnectionChip
        connectionId={CONNECTION_ID}
        name="Erli Demo"
        channel={CHANNEL}
        lead="platform"
      />,
    );

    const link = screen.getByRole('link', { name: 'Erli Demo, Erli' });
    expect(link).not.toHaveClass('connection-chip--name-first');
    expect(link.querySelector('.connection-chip__platform')).toHaveTextContent(/^Erli$/);
    expect(link.querySelector('.connection-chip__reveal')).toHaveTextContent(/^Erli Demo$/);
  });

  it('should not render a link when already on the connection page', () => {
    renderWithProviders(
      <ConnectionChip connectionId={CONNECTION_ID} name="Erli Demo" channel={CHANNEL} />,
      { route: `/connections/${CONNECTION_ID}` },
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Erli Demo')).toBeInTheDocument();
  });

  it('should render Unknown with the raw id in the title when the connection did not resolve', () => {
    renderWithProviders(
      <ConnectionChip connectionId={CONNECTION_ID} name={null} channel={CHANNEL} />,
    );

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('Unknown');
    expect(link.querySelector('.connection-chip__face')).toHaveTextContent(/^Unknown$/);
    expect(link).toHaveAttribute('title', CONNECTION_ID);
    expect(link).toHaveClass('connection-chip--unknown');
  });

  it('should render a busy placeholder instead of Unknown while loading', () => {
    renderWithProviders(
      <ConnectionChip connectionId={CONNECTION_ID} name={null} loading channel={CHANNEL} />,
    );

    expect(screen.queryByText('Unknown')).toBeNull();
    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('…')).toHaveClass('connection-chip__label');
  });

  it('should render System without a link for the placeholder connection id', () => {
    renderWithProviders(
      <ConnectionChip connectionId={SYSTEM_CONNECTION_ID} name={null} channel={CHANNEL} />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('should show the name on the face with no slide-out when no platform label is known', () => {
    renderWithProviders(
      <ConnectionChip
        connectionId={CONNECTION_ID}
        name="Erli Demo"
        channel={{ platformType: undefined, label: undefined }}
      />,
    );

    const link = screen.getByRole('link', { name: 'Erli Demo' });
    expect(link).toHaveClass('connection-chip--name-only');
    expect(link.querySelector('.connection-chip__reveal')).toBeNull();
    expect(link).not.toHaveAttribute('data-channel');
  });

  it('should render the face alone as a plain element when static, with no slide-out and no link', () => {
    renderWithProviders(
      <ConnectionChip static connectionId={CONNECTION_ID} name="Erli Demo" channel={CHANNEL} />,
    );

    expect(screen.queryByRole('link')).toBeNull();
    const chip = screen.getByText('Erli Demo').closest('.connection-chip');
    expect(chip).toHaveClass('connection-chip--static');
    expect(chip?.querySelector('.connection-chip__reveal')).toBeNull();
    expect(chip).toHaveAttribute('data-channel', 'erli');
  });

  it('should link to the given path with the given label and report the navigation', async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <ConnectionChip
        connectionId={CONNECTION_ID}
        name="Erli Demo"
        channel={CHANNEL}
        to="/x?scope=1"
        linkLabel="Open Erli Demo"
        onNavigate={onNavigate}
      />,
    );

    const link = screen.getByRole('link', { name: 'Open Erli Demo' });
    expect(link).toHaveAttribute('href', '/x?scope=1');
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
