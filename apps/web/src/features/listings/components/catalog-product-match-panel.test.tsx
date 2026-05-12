/**
 * Catalog Product Match Panel — unit tests
 *
 * @module apps/web/src/features/listings/components
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogProductMatchResult } from '../api/listings.types';
import { CatalogProductMatchPanel } from './catalog-product-match-panel';

function defaultProps(overrides: Partial<React.ComponentProps<typeof CatalogProductMatchPanel>> = {}) {
  return {
    result: undefined as CatalogProductMatchResult | undefined,
    unlinked: false,
    prefilledCount: 0,
    isLoading: false,
    barcode: '5901234123457',
    onUnlink: vi.fn(),
    onRelink: vi.fn(),
    onPickAmbiguous: vi.fn(),
    onSkipAmbiguous: vi.fn(),
    ...overrides,
  };
}

describe('CatalogProductMatchPanel', () => {
  it('renders nothing when result is undefined and not loading', () => {
    const { container } = render(<CatalogProductMatchPanel {...defaultProps()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on no_match', () => {
    const { container } = render(
      <CatalogProductMatchPanel {...defaultProps({ result: { kind: 'no_match' } })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders skeleton while loading', () => {
    render(<CatalogProductMatchPanel {...defaultProps({ isLoading: true })} />);
    expect(screen.getByText(/Checking Allegro catalog/i)).toBeInTheDocument();
  });

  it('renders linked unique branch with prefilled count and Unlink button', () => {
    const onUnlink = vi.fn();
    render(
      <CatalogProductMatchPanel
        {...defaultProps({
          result: {
            kind: 'unique',
            product: {
              id: 'cat-1',
              name: 'ACME Widget v2',
              ean: '5901234123457',
              parameters: [],
            },
          },
          prefilledCount: 3,
          onUnlink,
        })}
      />,
    );

    expect(screen.getByText('ACME Widget v2')).toBeInTheDocument();
    expect(screen.getByText(/3 fields auto-filled/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /unlink/i }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it('renders unlinked unique branch with Relink button', () => {
    const onRelink = vi.fn();
    render(
      <CatalogProductMatchPanel
        {...defaultProps({
          result: {
            kind: 'unique',
            product: {
              id: 'cat-1',
              name: 'ACME Widget',
              parameters: [],
            },
          },
          unlinked: true,
          onRelink,
        })}
      />,
    );

    expect(screen.getByText(/unlinked/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /relink/i }));
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('renders ambiguous branch and fires pick / skip callbacks', () => {
    const onPickAmbiguous = vi.fn();
    const onSkipAmbiguous = vi.fn();
    render(
      <CatalogProductMatchPanel
        {...defaultProps({
          result: {
            kind: 'ambiguous',
            products: [
              { id: 'cat-1', name: 'ACME Widget v1' },
              { id: 'cat-2', name: 'ACME Widget v2' },
            ],
          },
          onPickAmbiguous,
          onSkipAmbiguous,
        })}
      />,
    );

    expect(screen.getByText(/Multiple Allegro catalog products match/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('ACME Widget v2'));
    expect(onPickAmbiguous).toHaveBeenCalledWith('cat-2');

    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkipAmbiguous).toHaveBeenCalledTimes(1);
  });

  it('uses singular "field" when prefilledCount is 1', () => {
    render(
      <CatalogProductMatchPanel
        {...defaultProps({
          result: {
            kind: 'unique',
            product: { id: 'cat-1', name: 'Widget', parameters: [] },
          },
          prefilledCount: 1,
        })}
      />,
    );
    expect(screen.getByText(/1 field auto-filled/)).toBeInTheDocument();
  });

  it('shows "no fields auto-filled" message when prefilledCount is 0', () => {
    render(
      <CatalogProductMatchPanel
        {...defaultProps({
          result: {
            kind: 'unique',
            product: { id: 'cat-1', name: 'Widget', parameters: [] },
          },
          prefilledCount: 0,
        })}
      />,
    );
    expect(screen.getByText(/no fields auto-filled/i)).toBeInTheDocument();
  });
});
