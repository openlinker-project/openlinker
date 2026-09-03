import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalesDocumentMarketSectionSkeleton } from './sales-document-market-section-skeleton';

describe('SalesDocumentMarketSectionSkeleton (#2543)', () => {
  it('should render a live region announcing that markets are loading', () => {
    render(<SalesDocumentMarketSectionSkeleton />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading markets…')).toBeInTheDocument();
  });

  it('should render placeholder rows shaped like the real row, hidden from assistive tech', () => {
    const { container } = render(<SalesDocumentMarketSectionSkeleton />);
    const list = container.querySelector('.sales-document-market-row-list--skeleton');
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.sales-document-market-row--skeleton').length).toBeGreaterThan(0);
  });
});
