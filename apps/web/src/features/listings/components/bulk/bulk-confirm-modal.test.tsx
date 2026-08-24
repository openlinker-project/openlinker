/**
 * BulkConfirmModal tests
 *
 * Covers the demo read-only gate on the final "Create offers" submit (#1704)
 * and the per-variant / per-product count copy + mixed-publish warning (#1741).
 */
import { screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../test/test-utils';
import { BulkConfirmModal } from './bulk-confirm-modal';

const captureDemoEvent = vi.fn();
vi.mock('../../../demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));

beforeEach(() => {
  captureDemoEvent.mockClear();
});

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
      blockedCount={0}
      alreadyListedCount={0}
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

  it('captures demo_offer_create_attempted(mode=bulk) when a demo read-only viewer clicks the locked submit (#1788)', () => {
    renderModal({ demoReadOnly: true, marketplaceName: 'Allegro' });

    const lockWrapper = document.querySelector('.read-only-lock');
    expect(lockWrapper).not.toBeNull();
    fireEvent.click(lockWrapper as Element);

    expect(captureDemoEvent).toHaveBeenCalledWith('demo_offer_create_attempted', {
      platform: 'Allegro',
      mode: 'bulk',
    });
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

  it('names each not-listed reason separately (#2240)', () => {
    renderModal({ offerCount: 5, excludedCount: 3, blockedCount: 2, alreadyListedCount: 1 });

    // The operator selected 11 variants and 5 will be created; rolling the other
    // six into one number said nothing about which reason applied to which.
    expect(
      screen.getByRole('heading', { name: /list 5 of 11 selected variants on my allegro\?/i }),
    ).toBeInTheDocument();
    const summary = screen.getByText(/not listed:/i);
    expect(summary).toHaveTextContent('2 still need attention');
    expect(summary).toHaveTextContent('1 already on My Allegro');
    expect(summary).toHaveTextContent('3 switched off');
  });

  it('pluralises correctly at one offer (#2240)', () => {
    renderModal({ offerCount: 1, productCount: 1 });

    expect(
      screen.getByRole('heading', { name: /create 1 allegro offer on my allegro\?/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/across/i)).toHaveTextContent('1 product');
  });

  it('omits the not-listed clause when nothing is skipped', () => {
    renderModal({ excludedCount: 0, blockedCount: 0, alreadyListedCount: 0 });
    expect(screen.queryByText(/not listed:/i)).not.toBeInTheDocument();
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
