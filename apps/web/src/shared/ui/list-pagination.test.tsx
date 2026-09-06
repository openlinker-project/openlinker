/**
 * List Pagination tests (#2945)
 *
 * The point of this component is that pagination degrades PER AFFORDANCE, not
 * as a block, and that a missing total is never rendered as `0`. Both are
 * asserted here rather than left to inspection.
 */
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ListPagination } from './list-pagination';

function renderPagination(overrides: Partial<ComponentProps<typeof ListPagination>> = {}): {
  onOffsetChange: ReturnType<typeof vi.fn>;
} {
  const onOffsetChange = vi.fn();
  render(
    <ListPagination
      offset={0}
      limit={20}
      rowCount={20}
      total={null}
      totalState="pending"
      showTotalLoader={false}
      onOffsetChange={onOffsetChange}
      {...overrides}
    />
  );
  return { onOffsetChange };
}

describe('ListPagination (#2945)', () => {
  it('renders the exact total once it is known', () => {
    renderPagination({ total: 1234, totalState: 'known' });
    expect(screen.getByText(/Showing 1.*20 of/)).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('renders the N+ placeholder while the total is unknown - never a 0', () => {
    renderPagination({ total: null, totalState: 'pending', offset: 40, rowCount: 20 });

    expect(screen.getByText('60+')).toBeInTheDocument();
    // The number that IS shown is a floor the rows already prove, never a
    // claim that nothing matched.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps the placeholder when the count FAILED, and still never renders 0', () => {
    renderPagination({ total: null, totalState: 'unavailable', offset: 0, rowCount: 20 });

    expect(screen.getByText('20+')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByTitle(/could not be loaded/i)).toBeInTheDocument();
  });

  describe('per-affordance degradation', () => {
    it('enables Next from a FULL page with no total at all', async () => {
      // The whole benefit: Next needs no total, so it must not wait for one.
      const { onOffsetChange } = renderPagination({
        total: null,
        totalState: 'pending',
        rowCount: 20,
        limit: 20,
      });

      const next = screen.getByRole('button', { name: 'Next' });
      expect(next).toBeEnabled();
      await userEvent.click(next);
      expect(onOffsetChange).toHaveBeenCalledWith(20);
    });

    it('disables Next on a SHORT page with no total, because none can follow', () => {
      renderPagination({ total: null, totalState: 'pending', rowCount: 7, limit: 20 });
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it('enables Previous from any non-zero offset with no total', async () => {
      const { onOffsetChange } = renderPagination({
        offset: 40,
        total: null,
        totalState: 'pending',
      });

      const previous = screen.getByRole('button', { name: 'Previous' });
      expect(previous).toBeEnabled();
      await userEvent.click(previous);
      expect(onOffsetChange).toHaveBeenCalledWith(20);
    });

    it('disables Previous on the first page', () => {
      renderPagination({ offset: 0 });
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    });

    it('lets a known total overrule the full-page guess at the boundary', () => {
      // Exactly 20 rows in total: the page is full, but nothing follows it.
      renderPagination({ offset: 0, limit: 20, rowCount: 20, total: 20, totalState: 'known' });
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });
  });

  describe('the counting affordance', () => {
    it('renders nothing extra while the loader is still delayed', () => {
      const { container } = render(
        <ListPagination
          offset={0}
          limit={20}
          rowCount={20}
          total={null}
          totalState="pending"
          showTotalLoader={false}
          onOffsetChange={vi.fn()}
        />
      );
      expect(container.querySelector('.pagination__counting-dot')).toBeNull();
    });

    it('renders the dot once the hook says the delay has elapsed', () => {
      const { container } = render(
        <ListPagination
          offset={0}
          limit={20}
          rowCount={20}
          total={null}
          totalState="pending"
          showTotalLoader
          onOffsetChange={vi.fn()}
        />
      );
      expect(container.querySelector('.pagination__counting-dot')).not.toBeNull();
    });
  });

  it('says so plainly when the page is empty, rather than "Showing 1-0 of 0"', () => {
    renderPagination({ rowCount: 0, total: 0, totalState: 'known' });
    expect(screen.getByText('No results')).toBeInTheDocument();
  });
});
