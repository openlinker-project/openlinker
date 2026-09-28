/**
 * Why this screen is not a duplicate of Orders (#3102)
 *
 * Four properties, and each is one an ordinary "it renders" test would miss.
 *
 *   1. Both halves and the example are on screen on FIRST PAINT. Asserted
 *      synchronously, with no `findBy` and no `await`, because a query that
 *      waits cannot tell "rendered immediately" from "rendered after an
 *      effect" - and the whole point of this block is that the operator who
 *      does not know they need it still sees it.
 *   2. Nothing is behind a disclosure. A `<details>`, a toggle or any control
 *      at all would put the explanation one click away from the reader least
 *      likely to click.
 *   3. The rendered text is BYTE-IDENTICAL to the copy constants, asserted
 *      against the constants rather than against a hardcoded sentence, so a
 *      wording change moves both sides together instead of failing here. The
 *      `textContent` comparison is what makes it byte-identical: a `getByText`
 *      match alone only proves the WHITESPACE-NORMALISED forms agree.
 *   4. The component takes no arguments. That is the structural half of "the
 *      example is never interpolated from the task on screen" - a component
 *      with no access to a task cannot substitute one into illustrative prose
 *      and turn an explanation into a false claim about the operator's order.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FulfillmentVsOrdersExplainer } from './fulfillment-vs-orders-explainer';
import { renderWithProviders } from '../../../test/test-utils';
import { FULFILLMENT_WORK_DETAIL_COPY } from '../lib/fulfillment-work-detail.copy';

afterEach(cleanup);

const COPY = FULFILLMENT_WORK_DETAIL_COPY.vsOrders;

describe('FulfillmentVsOrdersExplainer', () => {
  it('should show both halves of the comparison and the example when it first renders', () => {
    renderWithProviders(<FulfillmentVsOrdersExplainer />);

    // No `findBy`, no `await`: present on the first paint or not at all.
    expect(screen.getByText(COPY.ordersLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.ordersText)).toBeInTheDocument();
    expect(screen.getByText(COPY.taskLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.taskText)).toBeInTheDocument();
    expect(screen.getByText(COPY.examplePrefix)).toBeInTheDocument();
    expect(screen.getByText(COPY.exampleText)).toBeInTheDocument();
  });

  it('should render each sentence byte-identically to the copy table', () => {
    renderWithProviders(<FulfillmentVsOrdersExplainer />);

    // Asserted against the constants, never a literal: a copy edit must move
    // the page and this test together rather than failing one of them.
    for (const sentence of [
      COPY.ordersLabel,
      COPY.ordersText,
      COPY.taskLabel,
      COPY.taskText,
      COPY.examplePrefix,
      COPY.exampleText,
    ]) {
      expect(screen.getByText(sentence).textContent).toBe(sentence);
    }
  });

  it('should pair each label with its own description rather than listing four loose strings', () => {
    const { container } = renderWithProviders(<FulfillmentVsOrdersExplainer />);

    // A comparison is only a comparison while each sentence stays attached to
    // the thing it is about; four siblings in source order would look identical
    // on a wide screen and come apart the moment the block reflows.
    const groups = [...container.querySelectorAll('dl > div')];
    expect(groups).toHaveLength(2);

    const [orders, thisTask] = groups;
    expect(within(orders as HTMLElement).getByText(COPY.ordersLabel)).toBeInTheDocument();
    expect(within(orders as HTMLElement).getByText(COPY.ordersText)).toBeInTheDocument();
    expect(within(thisTask as HTMLElement).getByText(COPY.taskLabel)).toBeInTheDocument();
    expect(within(thisTask as HTMLElement).getByText(COPY.taskText)).toBeInTheDocument();
  });

  it('should keep the explanation in the open rather than behind a disclosure', () => {
    const { container } = renderWithProviders(<FulfillmentVsOrdersExplainer />);

    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('summary')).toBeNull();
    // Any control at all would be a click between the explanation and the
    // reader who does not yet know they need it.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('should take no arguments, so the example cannot be interpolated from a task', () => {
    // The structural guarantee. `exampleText` names an illustrative order, a
    // shoe box and a pair of earbuds; substituting the task on screen would
    // turn an explanation into a claim that is false for the single-location
    // task most operators are looking at. A zero-arity component cannot.
    expect(FulfillmentVsOrdersExplainer).toHaveLength(0);
  });
});
