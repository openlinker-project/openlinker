/**
 * `DestinationRoutingCallout` unit tests (#2703 / #2704).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DestinationRoutingCallout } from './destination-routing-callout';

describe('DestinationRoutingCallout', () => {
  it('should show the reason and the unreachable destinations when routing narrowed partially', () => {
    render(
      <DestinationRoutingCallout
        reason="routed-destinations-partially-unavailable"
        detail="1 unresolved destination(s): conn-a"
      />
    );

    expect(screen.getByText('Some routed destinations unavailable')).toBeInTheDocument();
    expect(screen.getByText('1 unresolved destination(s): conn-a')).toBeInTheDocument();
  });

  it.each([null, undefined, 'routed-to-no-destination', 'from-the-future'])(
    'should render nothing when the reason is %p',
    (reason) => {
      const { container } = render(<DestinationRoutingCallout reason={reason} detail={null} />);

      expect(container).toBeEmptyDOMElement();
    }
  );
});
