import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SortArrow, SortField, SortStack, StaticSortLabel } from './sort-field';

describe('SortField', () => {
  it('should be quiet until it is the active sort', () => {
    render(<SortField label="Total" active={false} dir="asc" ariaLabel="Total, sort" onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Total, sort' })).not.toHaveClass('sort-field--active');
  });

  it('should mark the active sort and turn the arrow for descending', () => {
    const { container } = render(
      <SortField label="Total" active dir="desc" ariaLabel="Total, sorted descending" onClick={() => undefined} />,
    );
    expect(screen.getByRole('button')).toHaveClass('sort-field--active');
    expect(container.querySelector('.sort-arrow')).toHaveClass('sort-arrow--on', 'sort-arrow--desc');
  });

  it('should not turn the arrow for ascending', () => {
    const { container } = render(<SortArrow active dir="asc" />);
    expect(container.querySelector('.sort-arrow')).not.toHaveClass('sort-arrow--desc');
  });

  it('should hide the arrow from assistive technology', () => {
    const { container } = render(<SortArrow />);
    expect(container.querySelector('.sort-arrow')).toHaveAttribute('aria-hidden', 'true');
  });

  it('should report a click', async () => {
    const onClick = vi.fn();
    render(<SortField label="Total" active={false} dir="asc" ariaLabel="Total, sort" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('should lay out a stack, aligned to the end for a right-aligned column', () => {
    const { container } = render(
      <SortStack end>
        <StaticSortLabel label="Static" />
      </SortStack>,
    );
    expect(container.querySelector('.sort-stack')).toHaveClass('sort-stack--end');
    expect(screen.getByText('Static')).toHaveClass('sort-field--static');
  });
});
