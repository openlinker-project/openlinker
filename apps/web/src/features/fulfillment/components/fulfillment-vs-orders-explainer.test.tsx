/**
 * Why this screen is not a duplicate of Orders (#3102)
 *
 * Four properties, and each is one an ordinary "it renders" test would miss.
 *
 *   1. Both halves are on screen on FIRST PAINT. Asserted synchronously, with
 *      no `findBy` and no `await`, because a query that waits cannot tell
 *      "rendered immediately" from "rendered after an effect" - and the whole
 *      point of this block is that the operator who does not know they need it
 *      still sees it.
 *   2. Nothing is behind a disclosure.
 *   3. The rendered text is BYTE-IDENTICAL to the copy constants. The
 *      `textContent` comparison is what makes it byte-identical: a `getByText`
 *      match alone only proves the WHITESPACE-NORMALISED forms agree.
 *   4. The worked "For example" block is gone (#3096 review): with one
 *      warehouse it described a situation no install of this build produces.
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
  it('should show both halves of the comparison when it first renders', () => {
    renderWithProviders(<FulfillmentVsOrdersExplainer />);

    // No `findBy`, no `await`: present on the first paint or not at all.
    expect(screen.getByText(COPY.ordersLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.ordersText)).toBeInTheDocument();
    expect(screen.getByText(COPY.taskLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.taskText)).toBeInTheDocument();
  });

  it('should render each sentence byte-identically to the copy table', () => {
    renderWithProviders(<FulfillmentVsOrdersExplainer />);

    for (const sentence of [COPY.ordersLabel, COPY.ordersText, COPY.taskLabel, COPY.taskText]) {
      expect(screen.getByText(sentence).textContent).toBe(sentence);
    }
  });

  it('should render no worked example when it renders (#3096)', () => {
    const { container } = renderWithProviders(<FulfillmentVsOrdersExplainer />);

    expect(container.querySelector('.fulfilment-work-detail__example')).toBeNull();
    expect(screen.queryByText(/for example/i)).toBeNull();
    expect('examplePrefix' in COPY).toBe(false);
    expect('exampleText' in COPY).toBe(false);
  });

  it('should pair each label with its own description rather than listing four loose strings', () => {
    const { container } = renderWithProviders(<FulfillmentVsOrdersExplainer />);

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
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('should take no arguments, so nothing on screen can be interpolated from a task', () => {
    expect(FulfillmentVsOrdersExplainer).toHaveLength(0);
  });
});
