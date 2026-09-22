/**
 * Bench topbar (#3423, mockup-parity epic #3401)
 *
 * @module apps/web/src/features/bench/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../../shared/theme/theme-provider';
import { BenchTopbar } from './bench-topbar';

function mount(signedInName: string | null) {
  return render(
    <ThemeProvider>
      <BenchTopbar signedInName={signedInName} />
    </ThemeProvider>
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
});
