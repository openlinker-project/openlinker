/**
 * Restock Blocked Notice (#2381, returns spec § 5.4)
 *
 * The acceptance criterion this file exists for: **no surface renders blocked
 * units as restocked.** Everything else here defends the property that makes the
 * notice worth having — it is read from server STATE, so it survives a reload.
 *
 * @module apps/web/src/features/returns/components
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReturnRestockBlockedNotice } from './return-restock-blocked-notice';
import {
  RETURN_RESTOCK_ATTESTED_COPY,
  RETURN_RESTOCK_BLOCKED_COPY,
} from '../lib/restock-blocked.copy';
import type { ReturnRestockAttestation, ReturnRestockBlock } from '../api/returns.types';

function block(overrides: Partial<ReturnRestockBlock> = {}): ReturnRestockBlock {
  return {
    eventId: 'evt-1',
    returnLineId: 'line-1',
    quantity: 2,
    sku: 'SKU-1',
    reason: 'master-refused',
    detail: null,
    connectionId: 'conn-1',
    connectionName: 'Warehouse PrestaShop',
    state: 'blocked',
    ...overrides,
  };
}

function attestation(
  overrides: Partial<ReturnRestockAttestation> = {},
): ReturnRestockAttestation {
  return {
    eventId: 'evt-a',
    returnLineId: 'line-1',
    quantity: 2,
    actorUserId: 'user-1',
    occurredAt: '2026-08-20T10:00:00.000Z',
    note: null,
    ...overrides,
  };
}

function renderNotice(props: Partial<Parameters<typeof ReturnRestockBlockedNotice>[0]> = {}) {
  const onAttest = vi.fn();
  render(
    <ReturnRestockBlockedNotice
      attestations={[]}
      blocks={[block()]}
      lineSku="SKU-1"
      onAttest={onAttest}
      pending={false}
      sessionUserId="user-1"
      {...props}
    />,
  );
  return onAttest;
}

describe('ReturnRestockBlockedNotice (#2381)', () => {
  it('should never describe blocked units as restocked — the acceptance criterion', () => {
    renderNotice();

    const body = document.body.textContent ?? '';
    // The units are in `quantityReceived` and stay there until someone attests.
    // Any wording implying they were added back is the exact false claim this
    // whole surface exists to prevent.
    expect(body).not.toMatch(/restocked/i);
    expect(body).not.toMatch(/added back/i);
    expect(body).toContain('Stock was not added.');
  });

  it('should name the system that refused, in both the body and the remedy', () => {
    renderNotice();

    const body = document.body.textContent ?? '';
    expect(body).toContain('Warehouse PrestaShop');
    // The remedy has to be actionable without opening anything else: how many,
    // of what, and where.
    expect(body).toContain('2');
    expect(body).toContain('SKU-1');
  });

  it('should fall back to a readable phrase when the connection cannot be named', () => {
    renderNotice({ blocks: [block({ connectionName: null, connectionId: null })] });

    // Never a blank: "…but did not accept the change" reads as a truncated
    // sentence and an operator cannot act on it.
    expect(screen.getAllByText(/the system that owns your stock/).length).toBeGreaterThan(0);
  });

  it('should hide the Open action when no connection resolved, rather than disabling it', () => {
    renderNotice({ blocks: [block({ connectionId: null, connectionName: null })] });

    // A link that cannot go anywhere is worse than no link.
    expect(screen.queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument();
  });

  it('should sum several blocks on one line into ONE alarm', () => {
    renderNotice({
      // Same connection — so one alarm, summed.
      blocks: [block({ eventId: 'a', quantity: 2 }), block({ eventId: 'b', quantity: 3 })],
    });

    // Same goods, same master — N red boxes would read as N problems.
    expect(screen.getAllByText('Stock was not added.')).toHaveLength(1);
    expect(document.body.textContent).toContain('5');
  });

  it('should NOT attribute units to a master the act did not record', () => {
    renderNotice({
      blocks: [
        block({ eventId: 'a', quantity: 2, connectionId: 'conn-a', connectionName: 'Shop A' }),
        block({ eventId: 'b', quantity: 3, connectionId: 'conn-b', connectionName: 'Shop B' }),
      ],
    });

    // `masterConnectionId` is persisted per ACT, so two blocks on one line can
    // genuinely name different masters. Summing them under one name would send
    // the operator to add units that belong somewhere else.
    const body = document.body.textContent ?? '';
    expect(screen.getAllByText('Stock was not added.')).toHaveLength(2);
    expect(body).toContain('Shop A');
    expect(body).toContain('Shop B');
    // Never the cross-connection total.
    expect(body).not.toMatch(/Add 5 /);
  });

  it('should keep an unnamed master as its own group, not folded into a named one', () => {
    renderNotice({
      blocks: [
        block({ eventId: 'a', quantity: 2, connectionId: 'conn-a', connectionName: 'Shop A' }),
        block({ eventId: 'b', quantity: 4, connectionId: null, connectionName: null }),
      ],
    });

    // "We could not name the master" is a distinct fact from any named one.
    expect(screen.getAllByText('Stock was not added.')).toHaveLength(2);
    expect(document.body.textContent).toContain('the system that owns your stock');
  });

  it('should expand the explainer inline, and collapse it again', () => {
    renderNotice();

    const toggle = screen.getByRole('button', { name: RETURN_RESTOCK_BLOCKED_COPY.why });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(
      screen.getByText(/OpenLinker can publish your stock, but it can't always change it/),
    ).toBeInTheDocument();
    // No fix date is promised — the real remedy is a scheduling decision.
    expect(document.body.textContent).not.toMatch(/soon|coming|will be fixed/i);
  });

  it('should render the attested row instead of the alarm once handled', () => {
    renderNotice({ blocks: [], attestations: [attestation()] });

    expect(screen.queryByText('Stock was not added.')).not.toBeInTheDocument();
    expect(document.body.textContent).toContain(RETURN_RESTOCK_ATTESTED_COPY.byYou);
    // The load-bearing half survives the attribution.
    expect(document.body.textContent).toContain(RETURN_RESTOCK_ATTESTED_COPY.disclaimer);
    // And it offers nothing to click: the alarm is answered.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('should say "another operator" rather than invent a name it cannot resolve', () => {
    renderNotice({
      blocks: [],
      attestations: [attestation({ actorUserId: 'someone-else' })],
      sessionUserId: 'user-1',
    });

    const body = document.body.textContent ?? '';
    expect(body).toContain(RETURN_RESTOCK_ATTESTED_COPY.byOther);
    // Nothing resolves a user id to a display name, so a raw id must never leak
    // into operator copy — it is not an answer to "who" and reads as a defect.
    expect(body).not.toContain('someone-else');
  });

  it('should render nothing at all when a line has neither a block nor an attestation', () => {
    const { container } = render(
      <ReturnRestockBlockedNotice
        attestations={[]}
        blocks={[]}
        lineSku="SKU-1"
        onAttest={vi.fn()}
        pending={false}
        sessionUserId={null}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should disable the attestation while one is in flight', () => {
    renderNotice({ pending: true });

    expect(
      screen.getByRole('button', { name: RETURN_RESTOCK_BLOCKED_COPY.attest }),
    ).toBeDisabled();
  });
});
