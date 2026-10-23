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

  it('should render nothing when OpenLinker found no live work', () => {
    const { container } = render(<OrderPackingStage handled={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
