import { describe, expect, it } from 'vitest';

import { describeCancelWarning } from './bulk-order-actions.copy';

describe('describeCancelWarning', () => {
  it('should name the channel that cannot be told when the warning is participant-not-informed (B-13)', () => {
    const text = describeCancelWarning('participant-not-informed:c1', (id) =>
      id === 'c1' ? 'Shoper shop' : undefined,
    );

    expect(text).toContain('Shoper shop');
    expect(text).toContain('cannot be told');
  });
});
