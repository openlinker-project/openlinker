/**
 * Order Packing Stage tests (#3482)
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderPackingStage } from './order-packing-stage';

afterEach(cleanup);

describe('OrderPackingStage', () => {
  it('should render the stage as readable text, not only a marker', () => {
    render(<OrderPackingStage handled={{ stage: 'packing', workCount: 1 }} />);
    expect(screen.getByText('Packing')).toBeInTheDocument();
    expect(screen.getByText(/Being packed at a pack station now/)).toBeInTheDocument();
  });

  it('should render who packs it after the stage, as in the mockup', () => {
    render(<OrderPackingStage handled={{ stage: 'to-pack', workCount: 1 }} who="Unassigned" />);
    expect(screen.getByText('To pack')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('should render no packer line when there is nothing to say', () => {
    const { container } = render(
      <OrderPackingStage handled={{ stage: 'to-pack', workCount: 1 }} who={null} />
    );
    expect(container.querySelector('.orders-packed-tick__who')).toBeNull();
  });

  it('should render nothing when OpenLinker found no live work', () => {
    const { container } = render(<OrderPackingStage handled={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
