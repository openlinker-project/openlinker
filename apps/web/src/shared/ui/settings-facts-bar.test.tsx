import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsFactsBar } from './settings-facts-bar';

afterEach(cleanup);

describe('SettingsFactsBar', () => {
  it('should render each fact as a labelled cell with an optional note', () => {
    render(
      <SettingsFactsBar
        facts={[
          { id: 'a', label: 'Environment', value: 'development' },
          { id: 'b', label: 'Signed in as', value: 'admin', note: 'admin@example.com' },
          { id: 'c', label: 'API base URL', value: 'http://localhost:3000', mono: true, wide: true },
        ]}
      />,
    );

    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000')).toHaveAttribute('data-mono', 'true');
  });
});

/**
 * The rail heading is a `<button>`, and the global `button:hover` rule paints it
 * orange; only a selector that outranks it keeps the heading quiet. A class-only
 * rule would pass every visual check at rest and fail on hover, so the doubled
 * selector is pinned here for the states the global rules touch.
 */
describe('settings rail heading styles', () => {
  const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

  it.each(['', ':hover', ':active', ':focus-visible'])(
    'should outrank the global button rule for %s',
    (state) => {
      expect(css).toContain(`.settings-page__toc .settings-page__toc-page-btn${state} {`);
    },
  );

  it('should not tint the heading with the accent on hover', () => {
    expect(css).not.toContain('.settings-page__toc-page-btn:hover strong');
  });
});
