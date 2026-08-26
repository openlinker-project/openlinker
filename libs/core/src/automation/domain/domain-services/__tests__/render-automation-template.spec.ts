/**
 * renderAutomationTemplate specs (#2361, spec §5.3b)
 */
import {
  AUTOMATION_MERGE_FIELDS,
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
