import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

describe('StickyActionBar', () => {
  afterEach(cleanup);

  it('should hide itself from assistive tech and the tab order while clean', () => {
    render(
      <StickyActionBar visible={false} message="Unsaved" aria-label="Changes">
        <button type="button">Save</button>
      </StickyActionBar>,
    );
    const bar = screen.getByText('Unsaved').closest('.sticky-action-bar');
    expect(bar).toHaveAttribute('data-clean', 'true');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toHaveAttribute('inert');
  });

  it('should be reachable once there is something to save', () => {
    render(
      <StickyActionBar visible message="Unsaved" aria-label="Changes">
        <button type="button">Save</button>
      </StickyActionBar>,
    );
    expect(screen.getByRole('region', { name: 'Changes' })).toHaveAttribute('data-clean', 'false');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
