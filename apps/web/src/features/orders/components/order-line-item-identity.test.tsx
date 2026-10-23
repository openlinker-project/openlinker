import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderLineItemIdentity } from './order-line-item-identity';

afterEach(cleanup);

describe('OrderLineItemIdentity', () => {
  it('should render the name over a mono code line when both are known', () => {
    render(<OrderLineItemIdentity name="Phone case" code="CASE-1" placeholderName="Phone case" />);

    expect(screen.getByText('Phone case')).toHaveClass('order-line-item__name');
    const code = screen.getByText('CASE-1');
    expect(code).toHaveClass('order-line-item__sku', 'mono-text');
    expect(code).not.toHaveClass('text-muted');
  });

  it('should mute a stand-in id when the code is a fallback', () => {
    render(<OrderLineItemIdentity code="ol_variant_1" codeIsFallback placeholderName="ol_variant_1" />);

    expect(screen.getByText('ol_variant_1')).toHaveClass('text-muted');
  });

  it('should render no name line when the name is absent, never a placeholder', () => {
    const { container } = render(<OrderLineItemIdentity name={null} code="CASE-1" placeholderName="CASE-1" />);

    expect(container.querySelector('.order-line-item__name')).toBeNull();
  });

  it('should render the extra lines beneath the code when given', () => {
    render(
      <OrderLineItemIdentity
        name="Tee"
        code="TEE-L"
        placeholderName="Tee"
        extra={<span>Size: L</span>}
      />
    );

    expect(screen.getByText('Size: L').closest('.order-line-item__product-info')).not.toBeNull();
  });

  it('should hand the thumbnail the resolved image source when one is given', () => {
    const { container } = render(
      <OrderLineItemIdentity name="Tee" code="TEE-L" placeholderName="Tee" imageSrc="blob:tee" />
    );

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:tee');
  });
});
