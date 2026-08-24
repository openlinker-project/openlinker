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
import {
  resolveMissingTaxRateScope,
  resolveSalesDocumentBlockCopy,
} from './sales-document-block-copy';
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
    // `tax-rate-conflict` carries the dedicated `conflict` tone (#2253): a
    // shop-versus-channel disagreement is an advisory, not a failure.
    expect(
      resolveSalesDocumentBlockCopy(
        order({ salesDocumentBlockReason: 'tax-rate-conflict' }),
        false,
        t,
      ),
    ).toMatchObject({ tone: 'conflict' });
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

describe('resolveSalesDocumentBlockCopy - missing tax rate (#2254)', () => {
  const blocked = order({ salesDocumentBlockReason: 'missing-tax-rate' });

  it('points at the shop for a line OpenLinker has in its catalogue', () => {
    const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'invoice', [
      { name: 'Blue mug', inCatalogue: true },
    ]);
    expect(copy?.title).toContain('1 line has no tax rate.');
    expect(copy?.body).toContain('Blue mug');
    expect(copy?.body).toContain('Rates arrive with the product sync.');
  });

  it('says the fix will not release the order when nothing is in the catalogue', () => {
    const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'invoice', [
      { name: 'Marketplace-only widget', inCatalogue: false },
    ]);
    expect(copy?.title).toContain('is not in your catalogue.');
    expect(copy?.body).toContain('will not release this order');
  });

  it('counts the lines rather than naming one product on a long order', () => {
    const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'invoice', [
      { name: 'A', inCatalogue: true },
      { name: 'B', inCatalogue: true },
      { name: 'C', inCatalogue: true },
    ]);
    expect(copy?.title).toContain('3 lines have no tax rate.');
  });

  it('is about the delivery charge, not a line, when every line has a rate (#2260 review)', () => {
    // The gate also blocks when every product line IS rated but the shipping
    // charge cannot be attributed to any of them. Claiming "1 line has no tax
    // rate" there is flatly false, and there is no count to report.
    const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'invoice', []);
    expect(copy?.title).toBe('Not invoiced: the delivery charge has no tax rate.');
    expect(copy?.body).toContain('Every product line has a rate');
    expect(`${copy?.title ?? ''} ${copy?.body ?? ''}`).not.toMatch(/\d+ lines? has|Some lines/);
    expect(copy?.title).not.toContain('1 line');
  });

  it('renders the delivery-charge block with receipt-flavored copy', () => {
    const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'fiscal-receipt', []);
    expect(copy?.title).toBe('Not registered: the delivery charge has no tax rate.');
    expect(copy?.body).toContain('register this one outside OpenLinker');
  });

  it('scopes the block off the lines, so copy and controls read one answer', () => {
    expect(resolveMissingTaxRateScope([])).toBe('shipping');
    expect(resolveMissingTaxRateScope([{ name: 'A', inCatalogue: true }])).toBe('lines');
  });

  it('never claims an ambiguous tax class', () => {
    // The reason a rate is unknown (`TaxRateUnknownReason`) is dropped when the
    // master's answer is projected onto the catalogue, so the panel cannot tell
    // "ambiguous" apart from "blank". Copy that claimed it pointed the operator
    // at the product when the fix is in the shop's rate table.
    for (const lines of [
      [{ name: 'A', inCatalogue: true }],
      [{ name: 'A', inCatalogue: false }],
      [] as { name: string; inCatalogue: boolean }[],
    ]) {
      const copy = resolveSalesDocumentBlockCopy(blocked, false, t, 'invoice', lines);
      expect(`${copy?.title ?? ''} ${copy?.body ?? ''}`).not.toContain('ambiguous');
    }
  });
});

