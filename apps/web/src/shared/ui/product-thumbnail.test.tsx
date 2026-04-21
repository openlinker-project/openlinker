import { createRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProductThumbnail } from './product-thumbnail';

describe('ProductThumbnail', () => {
  it('should render an image with the given src when src is provided', () => {
    const { container } = render(
      <ProductThumbnail src="https://cdn.example.com/p.jpg" name="Brown bear cushion" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/p.jpg');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('decoding')).toBe('async');
  });

  it('should render the placeholder with the uppercase first letter when src is null', () => {
    const { container, getByText } = render(
      <ProductThumbnail src={null} name="brown bear" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('B')).toBeInTheDocument();
  });

  it('should render the placeholder when src is an empty string', () => {
    const { container, getByText } = render(
      <ProductThumbnail src="" name="Widget" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('W')).toBeInTheDocument();
  });

  it('should switch to the placeholder when the image fails to load', () => {
    const { container, getByText, queryByText } = render(
      <ProductThumbnail src="https://cdn.example.com/broken.jpg" name="Gizmo" />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(queryByText('G')).not.toBeInTheDocument();

    fireEvent.error(img!);

    expect(container.querySelector('img')).toBeNull();
    expect(getByText('G')).toBeInTheDocument();
  });

  it('should recover the image when src changes to a new working URL after an error', () => {
    const { container, rerender } = render(
      <ProductThumbnail src="https://cdn.example.com/broken.jpg" name="Gizmo" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(
      <ProductThumbnail src="https://cdn.example.com/working.jpg" name="Gizmo" />,
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/working.jpg');
  });

  it('should use empty alt by default and set aria-hidden on the wrapper', () => {
    const { container } = render(
      <ProductThumbnail src="https://cdn.example.com/p.jpg" name="Thing" />,
    );
    const wrapper = container.querySelector('.product-thumbnail');
    const img = container.querySelector('img');
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('should pass through explicit alt and drop aria-hidden on the wrapper', () => {
    const { container } = render(
      <ProductThumbnail
        src="https://cdn.example.com/p.jpg"
        name="Thing"
        alt="Brown bear cushion product photo"
      />,
    );
    const wrapper = container.querySelector('.product-thumbnail');
    const img = container.querySelector('img');
    expect(wrapper?.hasAttribute('aria-hidden')).toBe(false);
    expect(img?.getAttribute('alt')).toBe('Brown bear cushion product photo');
  });

  it('should render a visually-hidden alt next to the placeholder when src is missing and alt is explicit', () => {
    const { container } = render(
      <ProductThumbnail src={null} name="Thing" alt="Brown bear cushion product photo" />,
    );
    const srOnly = container.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe('Brown bear cushion product photo');
  });

  it('should not render a sr-only node when alt is the default empty string', () => {
    const { container } = render(<ProductThumbnail src={null} name="Thing" />);
    expect(container.querySelector('.sr-only')).toBeNull();
  });

  it('should apply size modifier class based on the size prop', () => {
    const { container: mdContainer } = render(
      <ProductThumbnail src={null} name="Default" />,
    );
    expect(mdContainer.querySelector('.product-thumbnail--md')).not.toBeNull();

    const { container: smContainer } = render(
      <ProductThumbnail src={null} name="Small" size="sm" />,
    );
    expect(smContainer.querySelector('.product-thumbnail--sm')).not.toBeNull();
  });

  it('should merge a custom className with the base class without overriding it', () => {
    const { container } = render(
      <ProductThumbnail src={null} name="Thing" className="extra-class" />,
    );
    const wrapper = container.querySelector('.product-thumbnail');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains('product-thumbnail')).toBe(true);
    expect(wrapper?.classList.contains('product-thumbnail--md')).toBe(true);
    expect(wrapper?.classList.contains('extra-class')).toBe(true);
  });

  it('should forward the ref to the wrapper span', () => {
    const ref = createRef<HTMLSpanElement>();
    render(<ProductThumbnail ref={ref} src={null} name="Thing" />);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(ref.current?.classList.contains('product-thumbnail')).toBe(true);
  });
});
