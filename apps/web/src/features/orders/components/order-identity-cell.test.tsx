import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderIdentityCell } from './order-identity-cell';
import { renderWithProviders } from '../../../test/test-utils';

const ORDER_ID = 'ol_order_a4f3b9c1d8e2f0a9b6c3d4e5f6a7b8c9';
/** What `shortenId()` emits for `ORDER_ID` — prefix + 4 + ellipsis + 2. */
const SHORT_ORDER_ID = 'ol_order_a4f3…c9';

describe('OrderIdentityCell', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('should lead with the order number linking to the order when the number is present', () => {
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="6839-2911-4402" itemCount={1} />,
    );

    const link = screen.getByRole('link', { name: '6839-2911-4402' });
    expect(link).toHaveAttribute('href', `/orders/${ORDER_ID}`);
    expect(screen.queryByText(SHORT_ORDER_ID)).toBeNull();
  });

  it('should fall back to the shortened internal id when the order number is absent', () => {
    renderWithProviders(<OrderIdentityCell orderId={ORDER_ID} orderNumber={null} itemCount={1} />);

    expect(screen.getByRole('link', { name: SHORT_ORDER_ID })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
  });

  it('should fall back to the shortened internal id when the order number is only whitespace', () => {
    renderWithProviders(<OrderIdentityCell orderId={ORDER_ID} orderNumber="   " itemCount={1} />);

    expect(screen.getByRole('link', { name: SHORT_ORDER_ID })).toBeInTheDocument();
  });

  it('should render the trimmed order number when the number carries surrounding space', () => {
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="  6839-2911-4402  " itemCount={1} />,
    );

    // `textContent`, not the accessible name — the latter normalises whitespace
    // and would pass on an untrimmed render.
    const link = screen.getByRole('link');
    expect(link.textContent).toBe('6839-2911-4402');
    expect(link).toHaveAttribute('title', '6839-2911-4402');
  });

  it('should render the trimmed item name when the name carries surrounding space', () => {
    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="  Terra Wool Coat  "
        itemCount={1}
      />,
    );

    expect(screen.getByText('Terra Wool Coat')).toHaveAttribute('title', 'Terra Wool Coat');
  });

  it('should shorten a long order reference to a head-tail form', () => {
    // Allegro's `orderNumber` IS its `checkoutFormId` — a 36-char UUID that
    // `buildOrderSummary` hands Shipments and Invoices raw (#1995).
    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="d1f4a2c3-9b8e-4f7a-a1b2-c3d4e5f60789"
        itemCount={1}
      />,
    );

    expect(screen.getByRole('link', { name: 'd1f4a2c3…f60789' })).toBeInTheDocument();
    // The full number stays recoverable through the copy button's name, since
    // Copy itself writes the internal id.
    expect(
      screen.getByRole('button', { name: 'Copy order ID d1f4a2c3-9b8e-4f7a-a1b2-c3d4e5f60789' }),
    ).toBeInTheDocument();
  });

  it('should render a short shop order number verbatim', () => {
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="ORD-2026-000123" itemCount={1} />,
    );

    expect(screen.getByRole('link', { name: 'ORD-2026-000123' })).toBeInTheDocument();
  });

  it('should render an order number of exactly the threshold length verbatim', () => {
    // 18 chars. Pins the threshold itself, so #2091 cannot silently shorten
    // differently once it deletes the Orders page's own copy of this rule.
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="ORD-2026-000123456" itemCount={1} />,
    );

    expect(screen.getByRole('link', { name: 'ORD-2026-000123456' })).toBeInTheDocument();
  });

  it('should shorten an order number one character past the threshold', () => {
    // 19 chars ⇒ head 8 + ellipsis + tail 6.
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="ORD-2026-0001234567" itemCount={1} />,
    );

    expect(screen.getByRole('link', { name: 'ORD-2026…234567' })).toBeInTheDocument();
  });

  it('should render the item thumbnail when the first item carries an image', () => {
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        firstItemImageUrl="https://cdn.example.com/coat.jpg"
        itemCount={1}
      />,
    );

    const image = container.querySelector('.product-thumbnail img');
    expect(image).toHaveAttribute('src', 'https://cdn.example.com/coat.jpg');
  });

  it("should render the thumbnail's initial-glyph placeholder when the item has no image", () => {
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        firstItemImageUrl={null}
        itemCount={1}
      />,
    );

    const thumbnail = container.querySelector('.product-thumbnail');
    expect(thumbnail?.querySelector('img')).toBeNull();
    expect(thumbnail).toHaveTextContent('T');
  });

  it('should take the thumbnail glyph from the display name when the item has no name either', () => {
    // The commonest production state: no adapter populates `firstItemImageUrl`
    // and `firstItemName` is nullable, so Shipments and Invoices rows land here.
    const { container } = renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="6839-2911-4402" itemCount={1} />,
    );

    expect(container.querySelector('.product-thumbnail')).toHaveTextContent('6');
  });

  it('should render no +N chip when the order has exactly one item', () => {
    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        itemCount={1}
      />,
    );

    expect(screen.getByText('Terra Wool Coat')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('should render the remaining-item count when the order has more than one item', () => {
    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        itemCount={5}
      />,
    );

    expect(screen.getByText('+4')).toHaveAttribute(
      'title',
      '4 more line items (5 in this order)',
    );
  });

  it('should keep the +N tooltip singular when exactly one item is hidden', () => {
    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        itemCount={2}
      />,
    );

    expect(screen.getByText('+1')).toHaveAttribute(
      'title',
      '1 more line item (2 in this order)',
    );
  });

  it('should render the item name with no chip when the item count is unknown', () => {
    // Shipments and Invoices feed a nullable `orderSummary` (#1995), so a null
    // count is a real production input, not a defensive branch.
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName="Terra Wool Coat"
        itemCount={null}
      />,
    );

    expect(screen.getByText('Terra Wool Coat')).toBeInTheDocument();
    expect(container.querySelector('.orders-more-count')).toBeNull();
  });

  it('should state the line-item count as a sentence when the first item name is unavailable', () => {
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName={null}
        itemCount={3}
      />,
    );

    expect(screen.getByText('3 line items')).toBeInTheDocument();
    // Never a dangling `+N` with nothing to attach it to.
    expect(container.querySelector('.orders-more-count')).toBeNull();
  });

  it('should render no second line when the order has a single unnamed item', () => {
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName={null}
        itemCount={1}
      />,
    );

    expect(container.querySelector('.orders-items-line')).toBeNull();
    expect(container.querySelector('.orders-cell-sub')).toBeNull();
  });

  it('should render an empty-value placeholder when there is no order id to resolve', () => {
    renderWithProviders(<OrderIdentityCell orderId="" />);

    expect(screen.getByLabelText('No value')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should copy the full internal order id when the shortened form is the one displayed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderWithProviders(<OrderIdentityCell orderId={ORDER_ID} orderNumber={null} itemCount={1} />);

    fireEvent.click(
      screen.getByRole('button', { name: `Copy internal order ID ${SHORT_ORDER_ID}` }),
    );

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(ORDER_ID);
    expect(
      await screen.findByRole('button', { name: `Copied internal order ID ${SHORT_ORDER_ID}` }),
    ).toBeInTheDocument();
  });

  it('should name the copy button after the order number when one is present', () => {
    renderWithProviders(
      <OrderIdentityCell orderId={ORDER_ID} orderNumber="6839-2911-4402" itemCount={1} />,
    );

    // Never the spelled-out 41-character id (#1996).
    expect(
      screen.getByRole('button', { name: 'Copy order ID 6839-2911-4402' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Copy ${ORDER_ID}` })).toBeNull();
  });

  it('should fire onNavigate when the name link is clicked but not when Copy is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const onNavigate = vi.fn();

    renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        itemCount={1}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy order ID 6839-2911-4402' }));
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: '6839-2911-4402' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
