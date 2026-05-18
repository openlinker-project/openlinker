import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BulkActionBar } from './bulk-action-bar';
import { Button } from './button';

describe('BulkActionBar', () => {
  it('renders count and actions when count > 0', () => {
    render(
      <BulkActionBar count={5} itemNoun="product" actions={<Button>Do it</Button>} />,
    );
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
  });

  it('uses plural noun in aria-label when count > 1', () => {
    render(<BulkActionBar count={3} itemNoun="product" actions={<button>x</button>} />);
    expect(screen.getByRole('region', { name: '3 products selected' })).toBeInTheDocument();
  });

  it('uses singular noun when count === 1', () => {
    render(<BulkActionBar count={1} itemNoun="product" actions={<button>x</button>} />);
    expect(screen.getByRole('region', { name: '1 product selected' })).toBeInTheDocument();
  });

  it('is aria-hidden when count is 0', () => {
    render(
      <BulkActionBar count={0} itemNoun="product" actions={<button>x</button>} />,
    );
    // count is still rendered (DOM), but the region is aria-hidden
    const node = document.querySelector('.bulk-action-bar');
    expect(node).toHaveAttribute('aria-hidden', 'true');
    expect(node).toHaveClass('bulk-action-bar--hidden');
  });

  it('renders optional hint slot', () => {
    render(
      <BulkActionBar
        count={2}
        itemNoun="product"
        hint="Max 100 per batch"
        actions={<button>x</button>}
      />,
    );
    expect(screen.getByText('Max 100 per batch')).toBeInTheDocument();
  });

  it('forwards ref to root element', () => {
    const ref = { current: null as HTMLDivElement | null };
    render(<BulkActionBar ref={ref} count={1} actions={<button>x</button>} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('merges className', () => {
    render(
      <BulkActionBar count={1} className="custom" actions={<button>x</button>} />,
    );
    const node = document.querySelector('.bulk-action-bar');
    expect(node).toHaveClass('bulk-action-bar', 'custom');
  });
});
