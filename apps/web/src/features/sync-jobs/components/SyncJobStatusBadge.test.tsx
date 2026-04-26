/**
 * SyncJobStatusBadge Tests
 *
 * Verifies the (status, outcome) → tone derivation introduced in issue #400
 * (Plan B for #391). The whole point of the change is that `succeeded +
 * business_failure` reads as a warning, not as success — these tests guard
 * the tone map so the regression can't slip back in.
 *
 * @module apps/web/src/features/sync-jobs/components
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { SyncJobStatusBadge } from './SyncJobStatusBadge';

describe('SyncJobStatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders queued with info tone', () => {
    render(<SyncJobStatusBadge status="queued" outcome={null} />);
    const badge = screen.getByText('queued').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--info');
  });

  it('renders running with review tone', () => {
    render(<SyncJobStatusBadge status="running" outcome={null} />);
    const badge = screen.getByText('running').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--review');
  });

  it('renders succeeded + outcome=ok with success tone', () => {
    render(<SyncJobStatusBadge status="succeeded" outcome="ok" />);
    const badge = screen.getByText('succeeded').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--success');
  });

  it('renders succeeded + outcome=business_failure with warning tone (label stays "succeeded")', () => {
    render(<SyncJobStatusBadge status="succeeded" outcome="business_failure" />);
    // Two "succeeded" labels would be in the DOM if cleanup isn't running.
    // afterEach(cleanup) above ensures we read this render's badge only.
    const badge = screen.getByText('succeeded').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--warning');
    expect(badge).not.toHaveClass('status-badge--success');
  });

  it('renders succeeded + outcome=null (legacy row) with success tone', () => {
    // Historical sync_jobs rows pre-dating issue #400 carry NULL outcome —
    // they were marked succeeded under the old contract and shouldn't switch
    // to warning retroactively just because outcome is unknown.
    render(<SyncJobStatusBadge status="succeeded" outcome={null} />);
    const badge = screen.getByText('succeeded').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--success');
  });

  it('renders dead with error tone', () => {
    render(<SyncJobStatusBadge status="dead" outcome={null} />);
    const badge = screen.getByText('dead').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--error');
  });
});
