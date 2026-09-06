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
import { formatPaginatedTotal } from '../hooks/use-paginated-total';

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
    // claim that nothing matched. Matched as a PHRASE, not as the bare string
    // `0`: `queryByText` is an exact full-text match, so with `60+` on screen
    // `queryByText('0')` can never fail and asserts nothing (#2957 review, S6).
    expect(screen.queryByText(/\bof 0\b/)).not.toBeInTheDocument();
  });

  it('keeps the placeholder when the count FAILED, and still never renders 0', () => {
    renderPagination({ total: null, totalState: 'unavailable', offset: 0, rowCount: 20 });

    expect(screen.getByText('20+')).toBeInTheDocument();
    expect(screen.queryByText(/\bof 0\b/)).not.toBeInTheDocument();
    expect(screen.getByTitle(/could not be loaded/i)).toBeInTheDocument();
  });

  it('says a FAILED count failed, in visible text a screen reader can reach', () => {
    // `pending` and `unavailable` both keep the `N+` placeholder. The hook goes
    // to real trouble to keep them apart, and a `title` alone keeps neither
    // promise: not reliably announced, absent on touch, hover-and-wait on
    // desktop. Without visible text the distinction is a comment.
    renderPagination({ total: null, totalState: 'unavailable', rowCount: 20 });
    expect(screen.getByText(/count unavailable/i)).toBeInTheDocument();
  });

  it('does NOT say the count failed while it is merely still counting', () => {
    renderPagination({ total: null, totalState: 'pending', rowCount: 20 });
    expect(screen.queryByText(/count unavailable/i)).not.toBeInTheDocument();
  });

  it('is a labelled navigation landmark, and announces the total when it lands', () => {
    const { rerender } = render(
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

    const pager = screen.getByRole('navigation', { name: 'Pagination' });
    expect(pager).toBeInTheDocument();
    // `aria-busy` on a non-live region announces nothing, so the summary is a
    // polite live region: a screen-reader user learns that `20+` became a real
    // number rather than being left with the placeholder.
    //
    // Asserted THROUGH the number rather than as "a live region exists
    // somewhere in the pager" (#2957 review, S6) - the latter passes with the
    // region wrapping the Previous button and the total outside it, which
    // announces nothing that changed.
    expect(screen.getByText('20+').closest('[aria-live="polite"]')).not.toBeNull();
    // The spinner is decorative and must not be read out beside it - and while
    // it is not showing, `aria-busy` must be absent rather than `false`.
    expect(pager.querySelector('.pagination__counting-dot')).toBeNull();
    expect(screen.getByText('20+').closest('[aria-live="polite"]')).not.toHaveAttribute(
      'aria-busy'
    );

    rerender(
      <ListPagination
        offset={0}
        limit={20}
        rowCount={20}
        total={1234}
        totalState="known"
        showTotalLoader={false}
        onOffsetChange={vi.fn()}
      />
    );
    expect(screen.getByText('1,234')).toBeInTheDocument();
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

    it('overrules a total the rows have already OVERRUN, so no row is unreachable', () => {
      // The page returned twenty rows for a total of nineteen. That is only
      // possible if the total is stale - and it can be, because the count is a
      // second request and `slaState` binds its own `new Date()` (#2957 review
      // round 5, I1). Trusting it here would disable Next over rows the list is
      // still returning.
      renderPagination({ offset: 0, limit: 20, rowCount: 20, total: 19, totalState: 'known' });
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
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
  it('marks the summary busy and hides the spinner from the reader while counting', () => {
    // Two properties the component states explicitly and nothing asserted
    // (#2957 review, S6): `aria-busy` tracks the delayed loader, and the dot is
    // decorative. A dot announced as content beside a live region is the
    // spinner being read out on every count.
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

    expect(screen.getByText('20+').closest('[aria-live="polite"]')).toHaveAttribute(
      'aria-busy',
      'true'
    );
    const dot = container.querySelector('.pagination__counting-dot');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // And the hiding must be on the DOT, not on its parent (#2957 review round
    // 3): moving the attribute up one level keeps the dot assertion green while
    // removing the total from the accessibility tree entirely.
    expect(screen.getByText('20+').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('renders an em-dash, not a floor of 0, when there is no page to floor on', () => {
    // The deep-link case S2 widened the signature for: `?offset=100` before a
    // row exists has no floor to state, and `0+` would be a floor computed from
    // nothing. Nothing exercised the `null` arm until now (#2957 review round 3).
    expect(formatPaginatedTotal(null, null)).toBe('—');
    expect(formatPaginatedTotal(null, 40)).toBe('40+');
    expect(formatPaginatedTotal(1234, null)).toBe('1,234');
  });
});
