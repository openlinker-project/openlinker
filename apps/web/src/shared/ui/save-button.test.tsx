import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveButton } from './save-button';

const labels = { idle: 'Save', saving: 'Saving', saved: 'Saved' };

describe('SaveButton', () => {
  afterEach(cleanup);

  it('should call onClick while idle', async () => {
    const onClick = vi.fn();
    render(<SaveButton state="idle" labels={labels} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should refuse a second click while saving and mark itself busy', () => {
    render(<SaveButton state="saving" labels={labels} />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveClass('is-saving');
  });

  it('should show the saved state', () => {
    render(<SaveButton state="saved" labels={labels} />);
    expect(screen.getByRole('button')).toHaveClass('is-saved');
  });
});
