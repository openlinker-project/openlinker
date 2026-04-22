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

  it('renders field, message, and code for each error when field is present', () => {
    const errors: OfferCreationError[] = [
      { field: 'parameters.EAN', code: 'MISSING_EAN', message: 'EAN is required.' },
    ];
    render(<OfferCreationErrorList errors={errors} />);

    expect(screen.getByText('parameters.EAN')).toBeInTheDocument();
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
    expect(screen.queryByText(/parameters\./)).not.toBeInTheDocument();
  });

  it('renders one row per error', () => {
    const errors: OfferCreationError[] = [
      { field: 'name', code: 'TOO_LONG', message: 'Too long.' },
      { field: 'category', code: 'INVALID', message: 'Invalid.' },
    ];
    render(<OfferCreationErrorList errors={errors} />);

    const list = screen.getByRole('list', { name: /offer creation errors/i });
    expect(list.querySelectorAll('li')).toHaveLength(2);
  });
});
