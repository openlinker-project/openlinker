/**
 * Sync Pacing Confirm Dialog — tests
 *
 * @module apps/web/src/features/settings/components
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import type { SyncPacingDiff } from '../lib/sync-pacing-changes';
import { SyncPacingConfirmDialog } from './sync-pacing-confirm-dialog';

const ONE_CHANGE: SyncPacingDiff = {
  changes: [
    {
      field: 'catalogueSweepBudget',
      label: 'Catalogue: products per run',
      fromLabel: '500',
      toLabel: '2000',
      effect: 'A run goes from about 46 s to about 184 s.',
    },
  ],
  lengthensDeletionWindow: false,
};

function render(diff: SyncPacingDiff, open = true): void {
  renderWithProviders(
    <SyncPacingConfirmDialog
      open={open}
      diff={diff}
      saving={false}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
}

describe('SyncPacingConfirmDialog', () => {
  it('should render nothing when nothing changed', () => {
    render({ changes: [], lengthensDeletionWindow: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should list only the changed value with its consequence', () => {
    render(ONE_CHANGE);

    expect(screen.getByText('Catalogue: products per run')).toBeInTheDocument();
    expect(screen.getByText(/A run goes from about 46 s to about 184 s/)).toBeInTheDocument();
    expect(screen.queryByText(/Stock: products per run/)).not.toBeInTheDocument();
  });

  it('should count the changes so the summary differs per save', () => {
    render({
      changes: [
        ...ONE_CHANGE.changes,
        {
          field: 'deletionAuditBudget',
          label: 'Deleted products: checked per run',
          fromLabel: '100',
          toLabel: '50',
          effect: 'How long a deleted product can keep selling goes from 41.7 d to 83.3 d.',
        },
      ],
      lengthensDeletionWindow: true,
    });

    expect(screen.getByText(/2 settings changed/)).toBeInTheDocument();
  });

  it('should call out a change that lengthens the deletion window', () => {
    render({ ...ONE_CHANGE, lengthensDeletionWindow: true });

    expect(screen.getByText('One change makes things worse')).toBeInTheDocument();
  });

  it('should not warn when no change lengthens the deletion window', () => {
    render(ONE_CHANGE);

    expect(screen.queryByText('One change makes things worse')).not.toBeInTheDocument();
  });
});
