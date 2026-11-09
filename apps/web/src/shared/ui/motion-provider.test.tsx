/**
 * MotionProvider and shared primitives in Polish - unit tests
 *
 * @module shared/ui
 */
import { cleanup, render, screen } from '@testing-library/react';
import { MotionConfigContext } from 'motion/react';
import { useContext, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleProvider } from '../i18n/locale-provider';
import { AccessDeniedState } from './feedback-state';
import { BulkActionBar } from './bulk-action-bar';
import { MotionProvider } from './motion-provider';

afterEach(() => {
  cleanup();
});

describe('MotionProvider', () => {
  function ReducedMotionProbe(): ReactElement {
    return <span data-testid="reduced">{useContext(MotionConfigContext).reducedMotion}</span>;
  }

  it('should make every animation follow the reduced-motion setting', () => {
    render(
      <MotionProvider>
        <ReducedMotionProbe />
      </MotionProvider>
    );
    expect(screen.getByTestId('reduced')).toHaveTextContent('user');
  });
});

describe('shared primitives in Polish', () => {
  it('should pluralise the bulk selection label when the locale is pl', () => {
    const { rerender } = render(
      <LocaleProvider locale="pl">
        <BulkActionBar count={2} actions={null} />
      </LocaleProvider>
    );
    expect(screen.getByText('zaznaczone')).toBeInTheDocument();
    rerender(
      <LocaleProvider locale="pl">
        <BulkActionBar count={5} actions={null} />
      </LocaleProvider>
    );
    expect(screen.getByText('zaznaczonych')).toBeInTheDocument();
  });

  it('should render the access-denied defaults in Polish when the locale is pl', () => {
    render(
      <LocaleProvider locale="pl">
        <AccessDeniedState />
      </LocaleProvider>
    );
    expect(screen.getByText('Brak dostępu')).toBeInTheDocument();
  });
});
