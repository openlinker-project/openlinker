/**
 * Return Stage Cell — the restock-blocked badge (#2381, spec § 5.4)
 *
 * The badge's three-state rule is the point. `restockBlocked` is
 * `boolean | null`, and `null` is not a weaker `false`: it means the read did
 * not report it. Rendering a badge there would invent an alarm; rendering
 * nothing for `false` is a real answer.
 *
 * @module apps/web/src/features/returns/components
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReturnStageCell } from './return-stage-cell';
import { RETURN_RESTOCK_BLOCKED_COPY } from '../lib/restock-blocked.copy';
import type { ReturnListItem } from '../api/returns.types';

function item(restockBlocked: boolean | null): ReturnListItem {
  return {
    id: 'ol_return_1',
    sourceConnectionId: 'conn-1',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_1',
    externalOrderId: 'EXT-1',
    origin: 'source_ingested',
    bucket: 'attributed',
    rawStatus: null,
    openedAt: null,
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    counters: {
      lineCount: 1,
      notReturnedLineCount: 0,
      quantityAdvised: 5,
      notReturnedQuantityAdvised: 0,
      quantityReceived: 5,
      quantityRestocked: 0,
      quantityScrapped: 0,
    },
    restockBlocked,
  };
}

describe('ReturnStageCell restock-blocked badge (#2381)', () => {
  it('should render the badge on an explicit true', () => {
    render(<ReturnStageCell item={item(true)} />);

    expect(screen.getByText(RETURN_RESTOCK_BLOCKED_COPY.badge)).toBeInTheDocument();
  });

  it.each([[false], [null]])('should render NO badge for %s', (value) => {
    render(<ReturnStageCell item={item(value)} />);

    // `false` is a real answer (nothing is blocked). `null` means the read did
    // not report it — inventing an alarm there would cry wolf on every row of an
    // unreadable page.
    expect(screen.queryByText(RETURN_RESTOCK_BLOCKED_COPY.badge)).not.toBeInTheDocument();
  });

  it('should render the badge BESIDE the stage, never instead of it', () => {
    render(<ReturnStageCell item={item(true)} />);

    // They answer different questions — "how far along is this" vs "does it
    // need me" — and a blocked restock does not move the stage.
    expect(screen.getByText(RETURN_RESTOCK_BLOCKED_COPY.badge)).toBeInTheDocument();
    expect(screen.getByText('Received — awaiting disposition')).toBeInTheDocument();
  });

  it('should share its title text with the per-line notice, from one module', () => {
    render(<ReturnStageCell item={item(true)} />);

    // § 5.4 requires the same string on every surface. It is imported, not
    // retyped — a second copy cannot exist without deleting an import.
    expect(screen.getByText('Restock blocked')).toBeInTheDocument();
  });
});
