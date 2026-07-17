/**
 * BulkConfirmModal tests
 *
 * Covers the demo read-only gate on the final "Create offers" submit (#1704):
 * a demo viewer sees the button rendered-but-disabled with a read-only
 * tooltip, while a permitted operator can confirm.
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
      rowCount={3}
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
});
