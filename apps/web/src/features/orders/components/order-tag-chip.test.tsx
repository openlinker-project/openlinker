/**
 * `OrderTagChip` unit tests (#3532/#3533).
 *
 * Pure/presentational — no providers needed. Pins: the name always renders
 * (colour is never the only signal), the dot carries `data-tag-color` for
 * the `--tag-*` CSS to key on, the `--sm` variant class is conditional, and
 * the remove button appears only when a caller wants one and fires the
 * callback without also navigating/bubbling.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderTagChip } from './order-tag-chip';

afterEach(cleanup);

describe('OrderTagChip (#3532/#3533)', () => {
  it('renders the tag name and a dot carrying the colour token', () => {
    render(<OrderTagChip tag={{ name: 'VIP', color: 'violet' }} />);

    expect(screen.getByText('VIP')).toBeInTheDocument();
    const chip = screen.getByText('VIP').closest('.order-tag');
    expect(chip).toHaveAttribute('data-tag-color', 'violet');
    expect(chip?.querySelector('.order-tag__dot')).not.toBeNull();
  });

  it('applies the --sm variant class only when asked', () => {
    const { rerender } = render(<OrderTagChip tag={{ name: 'B2B', color: 'blue' }} />);
    expect(screen.getByText('B2B').closest('.order-tag')).not.toHaveClass('order-tag--sm');

    rerender(<OrderTagChip tag={{ name: 'B2B', color: 'blue' }} small />);
    expect(screen.getByText('B2B').closest('.order-tag')).toHaveClass('order-tag--sm');
  });

  it('renders no remove button when onRemove is not supplied', () => {
    render(<OrderTagChip tag={{ name: 'Gift wrap', color: 'pink' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a labelled remove button and fires the callback on click, without bubbling', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const onRowClick = vi.fn();

    render(
      <div onClick={onRowClick}>
        <OrderTagChip tag={{ name: 'Gift wrap', color: 'pink' }} onRemove={onRemove} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'Remove tag Gift wrap' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('disables the remove button when removeDisabled is set', () => {
    render(
      <OrderTagChip tag={{ name: 'Gift wrap', color: 'pink' }} onRemove={vi.fn()} removeDisabled />,
    );
    expect(screen.getByRole('button', { name: 'Remove tag Gift wrap' })).toBeDisabled();
  });
});
