/**
 * `resolveSalesDocumentBlockCopy` unit tests (#2100, generalized #2156/#2160).
 *
 * Every branch is exercised directly rather than through a component render — the
 * reason the helper was moved out of `order-invoice-panel.tsx`, where only three of
 * the seven were reachable. The `invoice`-kind cases pin the ORIGINAL #2100 wording
 * verbatim (no `kind` argument = default `'invoice'`, so existing callers are
 * unaffected); the `fiscal-receipt` / `mixed` cases pin that the same reasons now
 * render kind-appropriate copy instead of always saying "invoice".
 */
import { describe, expect, it } from 'vitest';
import { resolveSalesDocumentBlockCopy } from './sales-document-block-copy';
import type { OrderRecord } from '../../orders';

/** `t(key, fallback)` behaves like the host's empty catalogue: always the fallback. */
const t = (_key: string, fallback: string): string => fallback;

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    customerId: null,
    sourceConnectionId: 'conn_src',
    sourceEventId: null,
    orderSnapshot: {},
    syncStatus: [],
    syncAttempts: [],
    recordStatus: 'ready',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as OrderRecord;
}

describe('resolveSalesDocumentBlockCopy — invoice kind (default, #2100 wording pinned)', () => {
  it('returns null when nothing is blocking and the browser sees no ambiguity', () => {
    expect(resolveSalesDocumentBlockCopy(order(), false, t)).toBeNull();
  });

  it('falls back to the derived ambiguity message for a row the gate has not re-evaluated', () => {
    // The columns are nullable with no backfill, so a pre-#2100 row carries no
    // reason. Dropping the message entirely would have been a regression.
    const copy = resolveSalesDocumentBlockCopy(order(), true, t);
    expect(copy).toMatchObject({ tone: 'warning', offerSetPrimary: true, detail: null });
    expect(copy?.title).toMatch(/Automatic invoicing is off/i);
  });

  it('prefers the persisted reason over the derived fallback', () => {
    // Both signals present: the backend's own decision must win, which is the
    // whole point of the change — the two can no longer disagree.
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-manual' }),
      true,
      t,
    );
    expect(copy?.title).toMatch(/invoices by hand/i);
    expect(copy?.offerSetPrimary).toBe(false);
  });

  it('renders the no-primary pairing with its detail and the remediation', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
        salesDocumentBlockDetail: '2 invoicing connections, none marked primary',
      }),
      false,
      t,
    );
    expect(copy).toMatchObject({
      tone: 'error',
      offerSetPrimary: true,
      detail: '2 invoicing connections, none marked primary',
    });
    expect(copy?.title).toMatch(/no primary connection/i);
  });

  it('renders the generic unrouted copy for a routing reason the router cannot produce yet', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'no-matching-rule',
      }),
      false,
      t,
    );
    expect(copy).toMatchObject({ tone: 'error', offerSetPrimary: false });
    expect(copy?.title).toMatch(/no route/i);
  });

  it('renders dedicated copy for no-configuration-for-country (#2170)', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'no-configuration-for-country',
      }),
      false,
      t,
    );
    expect(copy).toMatchObject({ tone: 'error', offerSetPrimary: false });
    expect(copy?.title).toMatch(/no rules configured for this country/i);
  });

  it('renders dedicated copy for threshold-currency-mismatch, and never implies a conversion (#2170)', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'threshold-currency-mismatch',
      }),
      false,
      t,
    );
    expect(copy).toMatchObject({ tone: 'error', offerSetPrimary: false });
    expect(copy?.title).toMatch(/does not match the rule's threshold/i);
    expect(copy?.body).toMatch(/never converts currencies/i);
  });

  it('renders manual quietly — info tone, no Set-a-primary', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-manual' }),
      false,
      t,
    );
    // A deliberate operator setting must not be dressed as a fault, and a primary
    // is the wrong fix for it.
    expect(copy).toMatchObject({ tone: 'info', offerSetPrimary: false });
  });

  it('warns on batched', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-batched' }),
      false,
      t,
    );
    expect(copy).toMatchObject({ tone: 'warning', offerSetPrimary: false });
    expect(copy?.title).toMatch(/batched invoicing is not available/i);
  });

  it('carries copy for the declared-but-unwritten reasons', () => {
    expect(
      resolveSalesDocumentBlockCopy(
        order({ salesDocumentBlockReason: 'missing-required-tax-id' }),
        false,
        t,
      ),
    ).toMatchObject({ tone: 'error' });
    expect(
      resolveSalesDocumentBlockCopy(
        order({ salesDocumentBlockReason: 'tax-rate-conflict' }),
        false,
        t,
      ),
    ).toMatchObject({ tone: 'error' });
  });

  it('states the honest minimum for a reason this build does not recognise', () => {
    const copy = resolveSalesDocumentBlockCopy(
      // A newer backend value reaching an older bundle. Saying nothing would leave
      // the operator with an uninvoiced order and no explanation at all.
      order({ salesDocumentBlockReason: 'some-future-reason' as never }),
      false,
      t,
    );
    expect(copy).toMatchObject({ tone: 'warning', offerSetPrimary: false });
    expect(copy?.title).toMatch(/not invoiced/i);
  });

  it('never leaks the reason literal into the rendered copy', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
      }),
      false,
      t,
    );
    const rendered = `${copy?.title ?? ''} ${copy?.body ?? ''}`;
    expect(rendered).not.toContain('unresolved-routing');
    expect(rendered).not.toContain('ambiguous-connection-no-primary');
  });
});

describe('resolveSalesDocumentBlockCopy — fiscal-receipt kind (#2156/#2160)', () => {
  it('talks about registering a receipt, never invoicing', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-manual' }),
      false,
      t,
      'fiscal-receipt',
    );
    expect(copy?.title).toMatch(/registers receipts by hand/i);
    expect(copy?.title).not.toMatch(/invoice/i);
    expect(copy?.body).not.toMatch(/invoice/i);
  });

  it('renders the no-primary pairing with receipt-flavored copy', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
      }),
      false,
      t,
      'fiscal-receipt',
    );
    expect(copy).toMatchObject({ tone: 'error', offerSetPrimary: true });
    expect(copy?.title).toMatch(/no primary connection/i);
    expect(copy?.body).toMatch(/register receipts/i);
  });

  it('the derived-ambiguity fallback also renders kind-aware copy', () => {
    const copy = resolveSalesDocumentBlockCopy(order(), true, t, 'fiscal-receipt');
    expect(copy?.title).toMatch(/Automatic fiscal registration is off/i);
  });

  it('warns on batched with a receipt-flavored title', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-batched' }),
      false,
      t,
      'fiscal-receipt',
    );
    expect(copy?.title).toMatch(/not registered/i);
    expect(copy?.title).toMatch(/batched fiscal registration/i);
  });
});

describe('resolveSalesDocumentBlockCopy — mixed kind (candidate pool spans both kinds)', () => {
  it('never claims a specific document kind the data does not support', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({ salesDocumentBlockReason: 'trigger-model-manual' }),
      false,
      t,
      'mixed',
    );
    expect(copy?.title).not.toMatch(/invoice/i);
    expect(copy?.title).not.toMatch(/receipt/i);
    expect(copy?.body).not.toMatch(/invoice/i);
    expect(copy?.body).not.toMatch(/receipt/i);
  });

  it('the no-primary pairing still offers the Set-a-primary remediation', () => {
    const copy = resolveSalesDocumentBlockCopy(
      order({
        salesDocumentBlockReason: 'unresolved-routing',
        salesDocumentUnresolvedReason: 'ambiguous-connection-no-primary',
      }),
      false,
      t,
      'mixed',
    );
    expect(copy).toMatchObject({ tone: 'error', offerSetPrimary: true });
  });
});
