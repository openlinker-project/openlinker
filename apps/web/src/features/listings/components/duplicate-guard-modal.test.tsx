/**
 * DuplicateGuardModal tests (#1837)
 *
 * Covers the destination-aware copy + primary action and the confirm/cancel
 * wiring of the soft duplicate guard.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { DuplicateGuardModal } from './duplicate-guard-modal';

afterEach(cleanup);

describe('DuplicateGuardModal', () => {
  it('renders marketplace copy and the "skip, don\'t duplicate" primary action', () => {
    renderWithProviders(
      <DuplicateGuardModal
        open
        onOpenChange={vi.fn()}
        kind="marketplace"
        destinationName="Allegro"
        duplicateCount={2}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 variants already on Allegro/)).toBeInTheDocument();
    expect(screen.getByText(/skipped, not duplicated/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Publish remaining variants' }),
    ).toBeInTheDocument();
  });

  it('renders shop copy and the "update existing" primary action', () => {
    renderWithProviders(
      <DuplicateGuardModal
        open
        onOpenChange={vi.fn()}
        kind="shop"
        destinationName="My WooCommerce"
        duplicateCount={1}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/1 variant already on My WooCommerce/)).toBeInTheDocument();
    expect(screen.getByText(/updates the existing product/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update existing' })).toBeInTheDocument();
  });

  it('invokes onConfirm when the primary action is clicked', () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <DuplicateGuardModal
        open
        onOpenChange={vi.fn()}
        kind="marketplace"
        destinationName="Allegro"
        duplicateCount={1}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Publish remaining variants/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
