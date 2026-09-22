/**
 * Bench topbar (#3423, mockup-parity epic #3401)
 *
 * @module apps/web/src/features/bench/components
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../shared/theme/theme-provider';
import { BenchTopbar } from './bench-topbar';

function mount(signedInName: string | null, canLeaveBench = false) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <BenchTopbar signedInName={signedInName} canLeaveBench={canLeaveBench} />
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('BenchTopbar (#3423)', () => {
  it('renders the brand and breadcrumb, always', () => {
    mount(null);

    expect(screen.getByText('OpenLinker')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
      'Operations'
    );
    expect(screen.getByText('Pack bench')).toBeInTheDocument();
  });

  it('renders the real theme toggle', () => {
    mount(null);

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
  });

  it('renders no user chip while signed out', () => {
    mount(null);

    expect(screen.queryByText(/./, { selector: '.bench-topbar__user-name' })).toBeNull();
  });

  it('renders the user chip with initials once signed in', () => {
    mount('Marta Kowalczyk');

    expect(screen.getByText('Marta Kowalczyk')).toBeInTheDocument();
    expect(screen.getByText('MK')).toBeInTheDocument();
  });

  it('renders no fabricated alerts count or connectivity indicator', () => {
    // See the module docblock — both are deliberate omissions, not gaps.
    mount('Marta Kowalczyk');

    expect(screen.queryByText(/alerts/i)).toBeNull();
  });

  // ── The way out (#3340 follow-up) ───────────────────────────────────────
  //
  // `/bench` renders outside `AuthenticatedAppLayout` and therefore has no
  // sidebar, so until this it could only be left by editing the address bar.
  describe('leaving the bench', () => {
    it('offers no exit to a packer, who has nowhere to go', () => {
      mount('Marta Kowalczyk', false);

      expect(screen.queryByRole('link', { name: /leave the bench/i })).toBeNull();
      // The crumb stays, as text — it names where you are, it is not a control.
      expect(screen.queryByRole('link', { name: 'Operations' })).toBeNull();
      expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
        'Operations'
      );
    });

    it('offers an exit to the work list for someone who can use it', () => {
      mount('Marta Kowalczyk', true);

      expect(screen.getByRole('link', { name: /leave the bench/i })).toHaveAttribute(
        'href',
        '/fulfillment'
      );
      // And the crumb's parent becomes what a breadcrumb's parent should be.
      expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute(
        'href',
        '/fulfillment'
      );
    });
  });
});
