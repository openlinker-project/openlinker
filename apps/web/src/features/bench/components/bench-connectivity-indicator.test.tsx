/**
 * Bench connectivity readout (#3422, on #3407's decision)
 *
 * Carried over from the retired `bench-topbar.test.tsx` when the readout moved
 * out of the bench's own topbar (#3653). The cases are unchanged: the readout
 * is what they pin, not where it sits.
 *
 * @module apps/web/src/features/bench/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BenchConnectivityIndicator } from './bench-connectivity-indicator';
import { BenchReachabilityContext } from '../hooks/bench-reachability-context';
import type { BenchConnectivity } from '../hooks/use-bench-reachability';

function mount(connectivity: BenchConnectivity = 'ok'): ReturnType<typeof render> {
  return render(
    <BenchReachabilityContext.Provider
      value={{
        unreachable: connectivity !== 'ok',
        connectivity,
        reportUnreachable: () => {},
        reportReached: () => {},
      }}
    >
      <BenchConnectivityIndicator />
    </BenchReachabilityContext.Provider>
  );
}

describe('the connectivity readout (#3422, on #3407\'s decision)', () => {
  it('reads all systems when the bench is reaching OpenLinker', () => {
    mount();

    expect(screen.getByTestId('bench-connectivity')).toHaveAttribute('data-connectivity', 'ok');
    expect(screen.getByText('All systems')).toBeInTheDocument();
  });

  it('never says the scanner is broken, because nothing here can know that', () => {
    // #3407's whole decision. The mockup labels the middle state "Scanner
    // offline" and explains it with "check the USB cable"; a keyboard-wedge
    // scanner is indistinguishable from a keyboard, so that sentence would be
    // a guess dressed as a diagnosis - and a status claim that turns out
    // false teaches a packer to distrust the red one too.
    mount('server-unreachable');

    const readout = screen.getByTestId('bench-connectivity');
    expect(readout).toHaveAttribute('data-connectivity', 'server-unreachable');
    expect(readout.textContent ?? '').not.toMatch(/scanner|hardware|usb|cable|printer/i);
    expect(screen.getByText('OpenLinker not answering')).toBeInTheDocument();
  });

  it('tells a dead link apart from a server that is not answering', () => {
    // Different remedies: one is "check the network at this bench", the other
    // is "the network here is fine, go and find whoever runs OpenLinker".
    mount('link-down');

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
    mount('link-down');

    const readout = screen.getByTestId('bench-connectivity');
    const everything = `${readout.textContent ?? ''} ${readout.getAttribute('title') ?? ''}`;
    expect(everything).not.toMatch(/sync|queue|when you(?:'| a)re back/i);
  });

  it('pairs the dot with a word, so colour is never the only signal', () => {
    mount('link-down');

    // The dot is decorative; the state has to survive a monochrome screen.
    expect(screen.getByTestId('bench-connectivity')).toHaveTextContent(/\S/);
  });
});

describe('the connectivity readout with no provider', () => {
  it('reads the quiet state, because it has nothing to report', () => {
    render(<BenchConnectivityIndicator />);

    expect(screen.getByTestId('bench-connectivity')).toHaveAttribute('data-connectivity', 'ok');
  });
});
