/**
 * `OrderPackedTick` unit tests (#2288).
 *
 * The component is one shared cell rendered by two surfaces with different
 * empty semantics — the desktop stack shows nothing for the ordinary unpacked
 * row, the mobile `<dd>` must never be empty — so both layouts are driven here
 * rather than through `OrdersListPage`, which would cost a mock API client and
 * a viewport mock per case.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OrderPackedTick } from './order-packed-tick';

const PACKED_AT = '2026-04-20T10:00:00.000Z';

afterEach(cleanup);

describe('OrderPackedTick (#2288)', () => {
  describe('not packed', () => {
    it('renders the empty fallback when packedAt is null', () => {
      render(<OrderPackedTick packedAt={null} layout="row" emptyFallback="—" />);

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Packed /)).not.toBeInTheDocument();
    });

    it('renders nothing at all when the desktop stack passes a null fallback', () => {
      // The common row: a marker on every unpacked row would be noise.
      const { container } = render(
        <OrderPackedTick packedAt={null} layout="stack" emptyFallback={null} />,
      );

      expect(container).toBeEmptyDOMElement();
    });

    it('treats an absent field (pre-#2287 payload) exactly like null', () => {
      render(<OrderPackedTick packedAt={undefined} layout="row" emptyFallback="—" />);

      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('packed', () => {
    it.each(['stack', 'row'] as const)(
      'states the fact in text and carries an absolute accessible name (%s layout)',
      (layout) => {
        render(<OrderPackedTick packedAt={PACKED_AT} layout={layout} emptyFallback="—" />);

        // Colour is never the only signal: the word is in the DOM either way.
        expect(screen.getByText('Packed')).toBeInTheDocument();
        // `aria-label` alongside `title` — a title alone is unreachable by
        // keyboard and absent on touch.
        const marker = screen.getByLabelText(/^Packed /);
        expect(marker).toHaveAttribute('title', marker.getAttribute('aria-label'));
        expect(screen.queryByText('—')).not.toBeInTheDocument();
      },
    );

    it('exposes the instant as a machine-readable <time>', () => {
      const { container } = render(
        <OrderPackedTick packedAt={PACKED_AT} layout="stack" emptyFallback={null} />,
      );

      expect(container.querySelector('time')).toHaveAttribute('datetime', PACKED_AT);
    });
  });
});
