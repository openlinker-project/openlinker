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

  it('should treat a blank order number as absent', () => {
    renderWithProviders(<OrderIdentityCell orderId={ORDER_ID} orderNumber="   " itemCount={1} />);

    expect(screen.getByRole('link', { name: SHORT_ORDER_ID })).toBeInTheDocument();
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

    expect(screen.getByText('+4')).toBeInTheDocument();
  });

  it('should render no second line when the first item name is unavailable', () => {
    const { container } = renderWithProviders(
      <OrderIdentityCell
        orderId={ORDER_ID}
        orderNumber="6839-2911-4402"
        firstItemName={null}
        itemCount={3}
      />,
    );

    expect(container.querySelector('.orders-items-line')).toBeNull();
    expect(screen.queryByText('+2')).toBeNull();
  });

  it('should render an empty-value placeholder when no order resolves', () => {
    renderWithProviders(<OrderIdentityCell orderId="" orderNumber="6839-2911-4402" />);

    expect(screen.getByLabelText('No value')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should copy the full internal order id, never the shortened form', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    renderWithProviders(<OrderIdentityCell orderId={ORDER_ID} orderNumber={null} itemCount={1} />);

    fireEvent.click(screen.getByRole('button', { name: `Copy ${ORDER_ID}` }));

    expect(writeText).toHaveBeenCalledWith(ORDER_ID);
    expect(writeText).not.toHaveBeenCalledWith(SHORT_ORDER_ID);
    expect(await screen.findByRole('button', { name: `Copied ${ORDER_ID}` })).toBeInTheDocument();
  });

  it('should fire onNavigate on the name link but not on Copy', () => {
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

    fireEvent.click(screen.getByRole('button', { name: `Copy ${ORDER_ID}` }));
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('link', { name: '6839-2911-4402' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
