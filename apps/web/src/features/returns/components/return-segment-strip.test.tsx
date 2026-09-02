/**
 * Return Segment Strip — the worklist strip (#2378)
 *
 * Two properties are the point. The strip has **seven** cards, because
 * `All open` is a filter and `All returns` is the clear — conflating them would
 * label closed, fully-refunded returns as open work. And the counts do **not**
 * sum to the total, because segments overlap.
 *
 * @module apps/web/src/features/returns/components
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnSegmentStrip } from './return-segment-strip';
import { RETURN_SEGMENT_VALUES, type ReturnSegmentCounts } from '../lib/return-segments';

const counts: ReturnSegmentCounts = {
  total: 10,
  bySegment: {
    needs_receiving: 4,
    needs_disposition: 3,
    restock_blocked: 1,
    money_pending: 5,
    orphans: 2,
    all_open: 8,
  },
};

describe('ReturnSegmentStrip (#2378)', () => {
  it('should render SEVEN cards — All returns plus the six segments', () => {
    render(<ReturnSegmentStrip counts={counts} selected={null} onSelect={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(7);
    expect(screen.getByText('All returns')).toBeInTheDocument();
    // `All open` is one of the six, NOT the clear card.
    expect(screen.getByText('All open')).toBeInTheDocument();
  });

  it('should render counts that deliberately do not sum to the total', () => {
    render(<ReturnSegmentStrip counts={counts} selected={null} onSelect={vi.fn()} />);

    const summed = RETURN_SEGMENT_VALUES.reduce((acc, s) => acc + counts.bySegment[s], 0);
    // Segments overlap; asserting the inequality pins that nothing downstream
    // starts treating them as a partition.
    expect(summed).not.toBe(counts.total);
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should mark All returns active when no segment is selected', () => {
    render(<ReturnSegmentStrip counts={counts} selected={null} onSelect={vi.fn()} />);

    const [allReturns] = screen.getAllByRole('button');
    expect(allReturns).toHaveAttribute('aria-pressed', 'true');
  });

  it('should select a segment on click', () => {
    const onSelect = vi.fn();
    render(<ReturnSegmentStrip counts={counts} selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Restock blocked'));

    expect(onSelect).toHaveBeenCalledWith('restock_blocked');
  });

  it('should clear the segment when the active card is clicked again', () => {
    const onSelect = vi.fn();
    render(<ReturnSegmentStrip counts={counts} selected="orphans" onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Orphans'));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('should clear the segment from the All returns card', () => {
    const onSelect = vi.fn();
    render(<ReturnSegmentStrip counts={counts} selected="orphans" onSelect={onSelect} />);

    fireEvent.click(screen.getByText('All returns'));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('should render em-dashes rather than zeroes before the counts arrive', () => {
    // A zero is a claim about the operator's data; an absent count is not.
    render(<ReturnSegmentStrip counts={null} selected={null} onSelect={vi.fn()} />);

    expect(screen.getAllByText('—')).toHaveLength(7);
  });
});
