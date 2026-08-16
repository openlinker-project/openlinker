/**
 * ConnectionFold tests (#2094)
 *
 * The component's load-bearing property — it never fires a per-row connection
 * fetch — is pinned transitively by each host page (all three assert
 * `connections.getById` is never called). These cover what those cannot: the
 * branches, and the guarantee that the fold's visibility is the exact complement
 * of the column it replaces.
 *
 * @module features/connections/components
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionFold } from './ConnectionFold';
import { renderWithProviders } from '../../../test/test-utils';

const CONNECTION_ID = 'aa966882-0d21-4e2f-9d5a-71c4a5f14cfb';

describe('ConnectionFold', () => {
  afterEach(cleanup);

  it('renders the adornment, the name link and a screen-reader prefix naming the fact', () => {
    const { container } = renderWithProviders(
      <ConnectionFold
        connectionId={CONNECTION_ID}
        connection={{ name: 'Erli Demo', status: 'active' }}
        adornment={<span className="channel-pill">Erli</span>}
      />,
    );

    const fold = container.querySelector('.conn-fold') as HTMLElement;
    expect(fold.querySelector('.conn-fold__adornment .channel-pill')).not.toBeNull();
    expect(within(fold).getByRole('link', { name: 'Erli Demo' })).toHaveAttribute(
      'href',
      `/connections/${CONNECTION_ID}`,
    );
    // The fold sits in another column's cell, so it has no `<th>` to give it
    // meaning — the prefix is what says `Erli Demo` is a connection.
    expect(fold.textContent).toContain('Connection:');
    // The reduction is the id, not the fact: no copy control anywhere.
    expect(within(fold).queryByRole('button')).toBeNull();
    expect(fold.querySelector('.copyable-id')).toBeNull();
  });

  it('surfaces a non-active status, because that is the answer the row is being asked for', () => {
    const { container } = renderWithProviders(
      <ConnectionFold
        connectionId={CONNECTION_ID}
        connection={{ name: 'InPost ShipX', status: 'needs_reauth' }}
      />,
    );

    const status = container.querySelector('.conn-fold__status') as HTMLElement;
    expect(status).toHaveAttribute('title', 'Re-auth');
    expect(status.querySelector('.conn-fold__status-dot')).not.toBeNull();
    // The dot alone would be colour-only; the word is in the accessibility tree.
    expect(within(status).getByText('Re-auth')).toHaveClass('sr-only');
  });

  it('renders no status element for a healthy connection', () => {
    const { container } = renderWithProviders(
      <ConnectionFold
        connectionId={CONNECTION_ID}
        connection={{ name: 'Erli Demo', status: 'active' }}
      />,
    );

    expect(container.querySelector('.conn-fold__status')).toBeNull();
  });

  it('falls back to a shortened id when the connection does not resolve', () => {
    // The one case where "the id is a desktop concern" inverts: a deleted or
    // mis-mapped connection is exactly when an operator needs its raw id, and
    // `EntityLabel`'s Unknown branch hides it in a `title`, which touch lacks.
    const { container } = renderWithProviders(
      <ConnectionFold connectionId={CONNECTION_ID} connection={null} />,
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(container.querySelector('.conn-fold__id')?.textContent).toBe('aa966882…4cfb');
    expect(within(container.querySelector('.conn-fold') as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('shows the loading placeholder instead of an id while the batched read settles', () => {
    const { container } = renderWithProviders(
      <ConnectionFold connectionId={CONNECTION_ID} connection={null} loading />,
    );

    expect(screen.getByText('…')).toHaveAttribute('aria-busy', 'true');
    // An id beside a spinner would read as "resolved, and unnamed".
    expect(container.querySelector('.conn-fold__id')).toBeNull();
  });

  it('renders nothing when there is no connection id', () => {
    const { container } = renderWithProviders(
      <ConnectionFold connectionId="" connection={null} />,
    );

    expect(container.querySelector('.conn-fold')).toBeNull();
  });

  it('is the exact CSS complement of the column it replaces', () => {
    // The highest-risk property of this design and the one jsdom cannot test:
    // if the two breakpoints ever drift by a pixel, an operator either sees the
    // connection twice or loses it in the gap. Neither unit tests nor type
    // checks would notice — so the guard reads the stylesheet.
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../index.css'),
      'utf8',
    );

    const queryFor = (selector: string): string | undefined =>
      css
        .split('@media ')
        .slice(1)
        .find((block) => block.slice(0, block.indexOf('}')).includes(selector))
        ?.split('{')[0]
        .trim();

    const foldQuery = queryFor('.conn-fold');
    const columnQuery = queryFor('.data-table__cell--hide-below-1024');

    expect(foldQuery).toBeDefined();
    expect(foldQuery).toBe(columnQuery);
  });
});
