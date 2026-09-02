/**
 * Order Phase Badge tests (#2310)
 *
 * @module apps/web/src/features/orders/components
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderPhaseBadge } from './order-phase-badge';

afterEach(cleanup);

describe('OrderPhaseBadge', () => {
  it('should render the phase label as text when the phase is known', () => {
    render(<OrderPhaseBadge phase="blocked" />);
    // Colour is never the only signal — the label must be readable text.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('should render nothing for a payload predating the phase field', () => {
    const { container } = render(<OrderPhaseBadge phase={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render nothing for an unrecognised phase', () => {
    const { container } = render(<OrderPhaseBadge phase="returned" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('should render a channel-reported label verbatim with its attribution', () => {
    // Synthetic fixture: no `OrderRecord` field supplies a vendor label until
    // Wave 4, so this exercises the seam rather than a shipped payload.
    render(<OrderPhaseBadge phase="vendor_authoritative" vendorLabel="Oczekuje na odbiór" />);
    expect(screen.getByText('Oczekuje na odbiór')).toBeInTheDocument();
    expect(screen.getByText(/reported by the sales channel/)).toBeInTheDocument();
  });

  it('should render the OpenLinker label when the channel reported none', () => {
    render(<OrderPhaseBadge phase="vendor_authoritative" />);
    expect(screen.getByText('Channel status')).toBeInTheDocument();
    expect(screen.queryByText(/reported by the sales channel/)).not.toBeInTheDocument();
  });
});
