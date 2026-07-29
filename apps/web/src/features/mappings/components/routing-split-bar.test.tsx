/**
 * RoutingSplitBar tests (#1739)
 *
 * @module apps/web/src/features/mappings/components
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutingSplitBar, type RoutingSplitBucket } from './routing-split-bar';

function buckets(overrides: Partial<RoutingSplitBucket>[] = []): RoutingSplitBucket[] {
  const base: RoutingSplitBucket[] = [
    { key: 'ol_managed_carrier::conn_inpost', label: 'InPost Sandbox', count: 5 },
    { key: 'ol_managed_carrier::conn_dpd', label: 'DPD Sandbox', count: 2 },
    { key: '__default__', label: 'My Shop - default', count: 4, isDefault: true },
  ];
  return base.map((bucket, i) => ({ ...bucket, ...overrides[i] }));
}

describe('RoutingSplitBar', () => {
  afterEach(cleanup);

  it('renders one legend entry per bucket with its label and count', () => {
    render(<RoutingSplitBar buckets={buckets()} />);

    expect(screen.getByText('InPost Sandbox')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('DPD Sandbox')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('My Shop - default')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders bar segments only for buckets with a non-zero count, sized by count', () => {
    const { container } = render(
      <RoutingSplitBar buckets={buckets([{}, { count: 0 }, {}])} />,
    );

    const segments = container.querySelectorAll('.routing-split__seg');
    expect(segments).toHaveLength(2);
    expect((segments[0] as HTMLElement).style.flexGrow).toBe('5');
    expect((segments[1] as HTMLElement).style.flexGrow).toBe('4');
    // The zero-count bucket keeps its legend entry (colour slot stays stable).
    expect(screen.getByText('DPD Sandbox')).toBeInTheDocument();
  });

  it('renders nothing when every bucket is empty', () => {
    const { container } = render(
      <RoutingSplitBar buckets={buckets([{ count: 0 }, { count: 0 }, { count: 0 }])} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the proportion bar decorative and the counts readable as text', () => {
    const { container } = render(<RoutingSplitBar buckets={buckets()} />);

    expect(container.querySelector('.routing-split__bar')).toHaveAttribute('aria-hidden', 'true');
    const legend = container.querySelector('.routing-split__legend');
    expect(legend).toHaveTextContent('InPost Sandbox 5');
  });
});
