/**
 * OfferCreationStatusBadge Tests
 *
 * @module apps/web/src/features/listings/components
 */
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OfferCreationStatusBadge } from './OfferCreationStatusBadge';
import type { OfferCreationStatus } from '../api/listings.types';

const STATUS_CASES: Array<{ status: OfferCreationStatus; label: string; tone: string }> = [
  { status: 'pending', label: 'Pending', tone: 'info' },
  { status: 'draft', label: 'Draft', tone: 'review' },
  { status: 'validating', label: 'Validating', tone: 'warning' },
  { status: 'active', label: 'Active', tone: 'success' },
  { status: 'failed', label: 'Failed', tone: 'error' },
];

describe('OfferCreationStatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it.each(STATUS_CASES)('renders $label for status $status with tone $tone', ({ status, label, tone }) => {
    render(<OfferCreationStatusBadge status={status} />);

    const badge = screen.getByText(label);
    expect(badge).toBeInTheDocument();

    const wrapper = badge.closest('.status-badge');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.className).toContain(`status-badge--${tone}`);
  });
});
