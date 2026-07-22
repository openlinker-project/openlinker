/**
 * BulkConfirmModal tests
 *
 * Covers the demo read-only gate on the final "Create offers" submit (#1704)
 * and the per-variant / per-product count copy + mixed-publish warning (#1741).
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkConfirmModal } from './bulk-confirm-modal';

function renderModal(props: Partial<Parameters<typeof BulkConfirmModal>[0]> = {}): {
  onConfirm: ReturnType<typeof vi.fn>;
} {
  const onConfirm = vi.fn();
  renderWithProviders(
    <BulkConfirmModal
      open
      onOpenChange={vi.fn()}
      offerCount={5}
      productCount={2}
      excludedCount={0}
      mixedPublishWarning={false}
      connectionName="My Allegro"
      marketplaceName="Allegro"
      initialPublishImmediately
      isSubmitting={false}
      demoReadOnly={false}
      errorMessage={null}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm };
}

describe('BulkConfirmModal', () => {
  afterEach(cleanup);

  it('disables the Create offers submit for a demo read-only viewer', () => {
    const { onConfirm } = renderModal({ demoReadOnly: true });

    const submit = screen.getByRole('button', { name: /create offers/i });
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('enables the Create offers submit when not read-only', () => {
    const { onConfirm } = renderModal({ demoReadOnly: false });

    const submit = screen.getByRole('button', { name: /create offers/i });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders the offer/product counts in title and summary', () => {
    renderModal({ offerCount: 5, productCount: 2 });

    expect(
      screen.getByRole('heading', { name: /create 5 allegro offers on my allegro\?/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/across/i)).toHaveTextContent('across 2 products');
  });

  it('mentions excluded variants only when excludedCount > 0', () => {
    renderModal({ excludedCount: 3 });
    expect(screen.getByText(/variant\(s\) excluded/i)).toBeInTheDocument();
  });

  it('omits the excluded-variant clause when excludedCount is 0', () => {
    renderModal({ excludedCount: 0 });
    expect(screen.queryByText(/variant\(s\) excluded/i)).not.toBeInTheDocument();
  });

  it('shows the mixed-publish warning when a listing has publish + draft variants', () => {
    renderModal({ mixedPublishWarning: true });
    expect(
      screen.getByText(/both published and draft variants/i),
    ).toBeInTheDocument();
  });

  it('hides the mixed-publish warning when all variants share a publish state', () => {
    renderModal({ mixedPublishWarning: false });
    expect(
      screen.queryByText(/both published and draft variants/i),
    ).not.toBeInTheDocument();
  });
});
