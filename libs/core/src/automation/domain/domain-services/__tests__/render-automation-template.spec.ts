/**
 * renderAutomationTemplate specs (#2361, spec §5.3b)
 */
import {
  AUTOMATION_MERGE_FIELDS,
  formatMergeAmount,
  formatMergeDate,
  renderAutomationTemplate,
} from '../render-automation-template';

describe('renderAutomationTemplate', () => {
  it('should substitute every declared merge field', () => {
    const context = {
      orderReference: 'REF-1',
      orderTotal: '99 PLN',
      orderPlacedAt: '2026-09-01',
      orderDispatchBy: '2026-09-03',
      holdReason: 'awaiting_payment',
      ruleName: 'Notify ops',
    };
    const template = AUTOMATION_MERGE_FIELDS.map((field) => `{${field}}`).join(' ');

    const rendered = renderAutomationTemplate(template, context);

    expect(rendered).toBe('REF-1 99 PLN 2026-09-01 2026-09-03 awaiting_payment Notify ops');
    expect(rendered).not.toContain('{');
  });

  it('should render an UNRESOLVABLE spec field verbatim rather than a false fallback', () => {
    // `{order.source}` / `{buyer.name}` / `{shipment.tracking}` have no source in
    // this build. Rendering them verbatim reads as "not supported"; rendering
    // `unknown` would read as a fact about the buyer or the parcel.
    expect(
      renderAutomationTemplate('{order.source} {buyer.name} {shipment.tracking}', {}),
    ).toBe('{order.source} {buyer.name} {shipment.tracking}');
  });

  it('should render an unrecognised placeholder VERBATIM rather than blanking it', () => {
    // Blanking silently produces an email that reads as broken; a visible typo
    // is something the operator can see and fix (spec §5.3b).
    expect(renderAutomationTemplate('Order {ordr.reference} ready', {})).toBe(
      'Order {ordr.reference} ready',
    );
  });

  it("should render the spec's stated fallback when a known field is unknown", () => {
    expect(renderAutomationTemplate('{hold.reason} / {order.dispatchBy}', {})).toBe(
      'no hold / no deadline',
    );
  });

  it('should treat an empty string as unknown so a blank never reaches the operator', () => {
    expect(renderAutomationTemplate('{hold.reason}', { holdReason: '' })).toBe('no hold');
  });

  it('should tolerate surrounding whitespace inside the braces', () => {
    expect(renderAutomationTemplate('{ rule.name }', { ruleName: 'R' })).toBe('R');
  });

  it('should leave an unclosed brace alone rather than swallowing the rest of the body', () => {
    expect(renderAutomationTemplate('cost {order.total', { orderTotal: '5' })).toBe(
      'cost {order.total',
    );
  });

  it('should not mutate its arguments', () => {
    const context = { ruleName: 'R' };
    renderAutomationTemplate('{rule.name}', context);
    expect(context).toEqual({ ruleName: 'R' });
  });
});

/**
 * The chips are operator-facing promises, so a rendered value that contradicts
 * its own tooltip is the same class of defect as offering an unrenderable field
 * — it just fails one layer further in. `check-automation-merge-field-mirror.mjs`
 * compares the two token LISTS and explicitly cannot see this; these do.
 */
describe('merge-field value formatting', () => {
  describe('formatMergeDate', () => {
    it('should render a calendar day, never a machine timestamp', () => {
      // The shipped defect: buyers received `2026-08-27T10:00:00.000Z`.
      const rendered = formatMergeDate(new Date('2026-08-27T10:00:00.000Z'));
      expect(rendered).toBe('2026-08-27');
      expect(rendered).not.toContain('T');
      expect(rendered).not.toContain('Z');
    });

    it('should report absence as undefined so the field falls back to its copy', () => {
      expect(formatMergeDate(undefined)).toBeUndefined();
      expect(formatMergeDate(null)).toBeUndefined();
      // An unparseable date is a gap, not the string "Invalid Date" in an email.
      expect(formatMergeDate(new Date('nonsense'))).toBeUndefined();
    });
  });

  describe('formatMergeAmount', () => {
    it("should render the amount at its currency's own precision", () => {
      // The shipped defect: `123.5 PLN` reads as a truncated number.
      expect(formatMergeAmount(123.5, 'PLN')).toBe('123.50 PLN');
      expect(formatMergeAmount(99, 'EUR')).toBe('99.00 EUR');
    });

    it('should honour a zero-decimal currency rather than assuming two', () => {
      expect(formatMergeAmount(1200, 'JPY')).toBe('1200 JPY');
    });

    it('should degrade rather than throw on a currency it does not recognise', () => {
      // A slightly plain total beats a failed step.
      expect(formatMergeAmount(10, 'NOTACURRENCY')).toBe('10 NOTACURRENCY');
    });

    it('should report an absent total as undefined, and an absent currency as the bare number', () => {
      expect(formatMergeAmount(undefined, 'PLN')).toBeUndefined();
      expect(formatMergeAmount(42, undefined)).toBe('42');
    });
  });
});
