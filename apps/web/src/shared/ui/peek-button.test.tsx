/**
 * PeekButton tests (#4029)
 *
 * @module shared/ui
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeekButton } from './peek-button';

afterEach(cleanup);

describe('PeekButton', () => {
  it('should forward the ref and button props to the trigger', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <PeekButton
        ref={ref}
        icon={<span>*</span>}
        iconKey="a"
        label="Dark"
        aria-label="Theme: Dark"
        onClick={onClick}
      />
    );
    const button = screen.getByRole('button', { name: 'Theme: Dark' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should keep the sliding name out of the accessibility tree', () => {
    render(
      <PeekButton
        icon={<span>*</span>}
        iconKey="a"
        label="Polski"
        labelLang="pl"
        aria-label="Language: Polski"
      />
    );
    const peek = document.querySelector('.peek-button__peek');
    expect(peek).toHaveAttribute('aria-hidden', 'true');
    expect(peek?.querySelector('[lang="pl"]')).toHaveTextContent('Polski');
  });

  it('should merge className and reflect reveal, touch size and open state on the wrapper', () => {
    const { container } = render(
      <PeekButton
        icon={<span>*</span>}
        iconKey="a"
        label="x"
        aria-label="x"
        className="extra"
        reveal="end"
        touchSize
        open
      />
    );
    expect(container.firstElementChild).toHaveClass(
      'peek-button',
      'peek-button--reveal-end',
      'peek-button--touch',
      'is-open',
      'extra'
    );
  });
});
