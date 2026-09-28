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
import { BenchReachabilityContext } from '../hooks/bench-reachability-context';
import type { BenchConnectivity } from '../hooks/use-bench-reachability';

function mount(
  signedInName: string | null,
  canLeaveBench = false,
  connectivity: BenchConnectivity = 'ok'
) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <BenchReachabilityContext.Provider
          value={{
            unreachable: connectivity !== 'ok',
            connectivity,
            reportUnreachable: () => {},
            reportReached: () => {},
          }}
        >
          <BenchTopbar signedInName={signedInName} canLeaveBench={canLeaveBench} />
        </BenchReachabilityContext.Provider>
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

describe('the connectivity readout (#3422, on #3407\'s decision)', () => {
  it('reads all systems when the bench is reaching OpenLinker', () => {
    mount('Anna Pakowska');

    expect(screen.getByTestId('bench-connectivity')).toHaveAttribute('data-connectivity', 'ok');
    expect(screen.getByText('All systems')).toBeInTheDocument();
  });

  it('never says the scanner is broken, because nothing here can know that', () => {
    // #3407's whole decision. The mockup labels the middle state "Scanner
    // offline" and explains it with "check the USB cable"; a keyboard-wedge
    // scanner is indistinguishable from a keyboard, so that sentence would be
    // a guess dressed as a diagnosis - and a status claim that turns out
    // false teaches a packer to distrust the red one too.
    mount('Anna Pakowska', false, 'server-unreachable');

    const readout = screen.getByTestId('bench-connectivity');
    expect(readout).toHaveAttribute('data-connectivity', 'server-unreachable');
    expect(readout.textContent ?? '').not.toMatch(/scanner|hardware|usb|cable|printer/i);
    expect(screen.getByText('OpenLinker not answering')).toBeInTheDocument();
  });

  it('tells a dead link apart from a server that is not answering', () => {
    // Different remedies: one is "check the network at this bench", the other
    // is "the network here is fine, go and find whoever runs OpenLinker".
    mount('Anna Pakowska', false, 'link-down');

    expect(screen.getByTestId('bench-connectivity')).toHaveAttribute(
      'data-connectivity',
      'link-down'
    );
    expect(screen.getByText('No connection')).toBeInTheDocument();
  });

  it('never promises that scans will sync later', () => {
    // The mockup's red banner reads "your last 2 scans haven't synced yet and
    // will as soon as you're back online". `use-bench-reachability.ts` refuses
    // to build that offline queue, so no copy here may imply one exists.
    mount('Anna Pakowska', false, 'link-down');

    const readout = screen.getByTestId('bench-connectivity');
    const everything = `${readout.textContent ?? ''} ${readout.getAttribute('title') ?? ''}`;
    expect(everything).not.toMatch(/sync|queue|when you(?:'| a)re back/i);
  });

  it('pairs the dot with a word, so colour is never the only signal', () => {
    mount('Anna Pakowska', false, 'link-down');

    // The dot is decorative; the state has to survive a monochrome screen.
    expect(screen.getByTestId('bench-connectivity')).toHaveTextContent(/\S/);
  });
});
