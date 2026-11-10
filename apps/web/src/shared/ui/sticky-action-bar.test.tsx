/**
 * StickyActionBar tests (#3935)
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StickyActionBar } from './sticky-action-bar';

afterEach(cleanup);

describe('StickyActionBar', () => {
  it('should list what is missing, and say it is ready when nothing is', () => {
    const { rerender } = render(
      <StickyActionBar missingLabel="Missing:" missing="name, gift" readyText="Ready">
        <button type="button">Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByText('Missing:')).toBeInTheDocument();
    expect(screen.getByText('name, gift')).toBeInTheDocument();

    rerender(
      <StickyActionBar missingLabel="Missing:" missing="" readyText="Ready">
        <button type="button">Go</button>
      </StickyActionBar>,
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('should hide itself from assistive tech and the tab order while clean', () => {
    render(
      <StickyActionBar visible={false} message="Unsaved" aria-label="Changes">
        <button type="button">Save</button>
      </StickyActionBar>,
    );
    const bar = screen.getByText('Unsaved').closest('.pm-actionbar');
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
