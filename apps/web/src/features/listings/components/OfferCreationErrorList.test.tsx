/**
 * OfferCreationErrorList Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OfferCreationErrorList } from './OfferCreationErrorList';
import type { OfferCreationError } from '../api/listings.types';

describe('OfferCreationErrorList', () => {
  afterEach(() => {
    cleanup();
  });

  it('returns null when errors are null', () => {
    const { container } = render(<OfferCreationErrorList errors={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when errors are an empty array', () => {
    const { container } = render(<OfferCreationErrorList errors={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders field as breadcrumb, plus message and code when field is present', () => {
    const errors: OfferCreationError[] = [
      { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
    ];
    render(<OfferCreationErrorList errors={errors} />);

    // Path renders as a copy-button. Trail segment + leaf segment exist.
    const fieldButton = screen.getByRole('button', { name: /Copy field path parameters\.EAN/i });
    expect(fieldButton).toHaveTextContent(/parameters/);
    expect(fieldButton).toHaveTextContent(/EAN/);
    expect(screen.getByText('EAN is required.')).toBeInTheDocument();
    expect(screen.getByText('MISSING_EAN')).toBeInTheDocument();
  });

  it('renders message and code when field is missing', () => {
    const errors: OfferCreationError[] = [
      { code: 'GENERIC_FAILURE', message: 'Something went wrong.' },
    ];
    render(<OfferCreationErrorList errors={errors} />);

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByText('GENERIC_FAILURE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy field path/i })).not.toBeInTheDocument();
  });

  it('renders one row per error', () => {
    const errors: OfferCreationError[] = [
      { field: 'name', code: 'TOO_LONG', message: 'Too long.' },
      { field: 'category', code: 'INVALID', message: 'Invalid.' },
    ];
    render(<OfferCreationErrorList errors={errors} />);

    const list = screen.getByRole('list', { name: /^errors$/i });
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });

  describe('Allegro friendly-message allowlist (#448)', () => {
    it('renders the friendly message for mapped codes and keeps the raw message in a collapsed <details>', () => {
      const errors: OfferCreationError[] = [
        {
          code: 'SAFETY_INFO_NOT_DEFINED',
          message: 'Safety information was not defined for product',
        },
      ];
      render(<OfferCreationErrorList errors={errors} />);

      // Primary message slot now carries the friendly text.
      expect(
        screen.getByText(/verify the discriminator/i),
      ).toBeInTheDocument();
      // Code badge remains visible for grep / debugging.
      expect(screen.getByText('SAFETY_INFO_NOT_DEFINED')).toBeInTheDocument();
      // Raw message is rendered inside a <details>, collapsed by default.
      const details = screen.getByText(/^original message$/i).closest('details');
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute('open');
      expect(
        screen.getByText('Safety information was not defined for product'),
      ).toBeInTheDocument();
    });

    it('does not render the <details> block for unmapped codes (existing behaviour preserved)', () => {
      const errors: OfferCreationError[] = [
        { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
      ];
      render(<OfferCreationErrorList errors={errors} />);

      // Allegro's raw message is the only message rendered.
      expect(screen.getByText('EAN is required.')).toBeInTheDocument();
      // No <details> block means no "Original message" summary.
      expect(screen.queryByText(/^original message$/i)).toBeNull();
    });
  });
});
