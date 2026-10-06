import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DetailSection } from './detail-section';

afterEach(cleanup);

describe('DetailSection', () => {
  it('should render a titled card region when a title is given', () => {
    render(
      <DetailSection title="Details" aria-label="Details">
        <p>body</p>
      </DetailSection>
    );

    const region = screen.getByRole('region', { name: 'Details' });
    expect(region).toHaveClass('detail-card');
    expect(screen.getByRole('heading', { name: 'Details' })).toHaveClass('detail-card__title');
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('should render no heading row when neither title nor aside is given', () => {
    const { container } = render(
      <DetailSection>
        <p>body</p>
      </DetailSection>
    );

    expect(container.querySelector('.detail-card__head')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('should add the tone modifier and keep a caller class when a tone is passed', () => {
    const { container } = render(
      <DetailSection tone="hero" className="extra">
        <p>body</p>
      </DetailSection>
    );

    const card = container.querySelector('section');
    expect(card).toHaveClass('detail-card', 'detail-card--hero', 'extra');
  });

  it('should render the aside beside the title when one is given', () => {
    render(
      <DetailSection title="Packer" titleAside={<span>3 waiting</span>}>
        <p>body</p>
      </DetailSection>
    );

    expect(screen.getByText('3 waiting').closest('.detail-card__aside')).not.toBeNull();
  });
});
