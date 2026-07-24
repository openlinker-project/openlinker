import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { ReadOnlyLock } from './read-only-lock';

describe('ReadOnlyLock', () => {
  afterEach(cleanup);

  it('renders children untouched when inactive', () => {
    renderWithProviders(
      <ReadOnlyLock active={false} message="Locked">
        <button type="button">Do the thing</button>
      </ReadOnlyLock>,
    );

    expect(screen.getByRole('button', { name: 'Do the thing' })).toBeInTheDocument();
    expect(document.querySelector('.read-only-lock')).toBeNull();
  });

  it('fires onLockedClick when the locked wrapper is clicked and active', () => {
    const onLockedClick = vi.fn();
    renderWithProviders(
      <ReadOnlyLock active message="Locked" onLockedClick={onLockedClick}>
        <button type="button" disabled>
          Do the thing
        </button>
      </ReadOnlyLock>,
    );

    const wrapper = document.querySelector('.read-only-lock');
    expect(wrapper).not.toBeNull();
    fireEvent.click(wrapper as Element);

    expect(onLockedClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when onLockedClick is omitted and active', () => {
    renderWithProviders(
      <ReadOnlyLock active message="Locked">
        <button type="button" disabled>
          Do the thing
        </button>
      </ReadOnlyLock>,
    );

    const wrapper = document.querySelector('.read-only-lock');
    expect(() => fireEvent.click(wrapper as Element)).not.toThrow();
  });
});
